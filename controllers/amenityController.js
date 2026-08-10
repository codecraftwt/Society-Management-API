

const {
  Amenity,
  AmenityBooking,
  User,
  Flat,
  HouseHoldMember,
  Notification,
  sequelize,
} = require("../models");

const { Op }                   = require("sequelize");
const Razorpay                 = require("razorpay");
const crypto                   = require("crypto");
const { sendPushNotification } = require("../utils/pushNotification");

/* ─── Razorpay client (initialised once) ─── */
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/* ─── Payment window: how long we hold a slot while the user pays ─── */
const PAYMENT_WINDOW_MINUTES = 15;

/* ─── Helpers ─── */
const addMinutes = (timeStr, minutes) => {
  const [h, m] = timeStr.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toTimeString().split(" ")[0];
};

const getUserFlatId = async (userId) => {
  const primaryFlat = await Flat.findOne({ where: { resident_id: userId } });
  if (primaryFlat) return primaryFlat.id;
  const familyMember = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (familyMember) return familyMember.flat_id;
  return null;
};

const paymentExpiresAt = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + PAYMENT_WINDOW_MINUTES);
  return d;
};

/* Notify admin helper */
const notifyAdmin = async (adminUser, title, msg, route, societyId, transaction) => {
  const notification = await Notification.create({
    title, message: msg,
    type: "AMENITY_APPROVAL",
    action_type: "VIEW_AMENITY",
    action_route: route,
    society_id: societyId,
    receiver_user_id: adminUser.id,
  }, transaction ? { transaction } : {});

  if (global.io) global.io.to(`user_${adminUser.id}`).emit("new_notification", notification);
  if (adminUser.fcm_token) {
    sendPushNotification(adminUser.fcm_token, title, msg, { route }).catch(console.error);
  }
};

/* Notify resident helper */
const notifyResident = async (userId, title, msg, societyId) => {
  const notification = await Notification.create({
    title, message: msg,
    type: "AMENITY",
    action_type: "VIEW_AMENITY",
    action_route: "/resident/amenities",
    society_id: societyId,
    receiver_user_id: userId,
  });
  if (global.io) global.io.to(`user_${userId}`).emit("new_notification", notification);

  const user = await User.findByPk(userId, { attributes: ["fcm_token"] });
  if (user?.fcm_token) {
    sendPushNotification(user.fcm_token, title, msg, { route: "/resident/amenities" }).catch(console.error);
  }
};

/* ═══════════════════════════════════════════
   GET ALL AMENITIES
═══════════════════════════════════════════ */
exports.getAllAmenities = async (req, res) => {
  try {
    const amenities = await Amenity.findAll({
      where: { society_id: req.user.society_id },
      attributes: [
        "id", "name", "icon", "type", "booking_type",
        "rate_per_hour", "opening_time", "closing_time",
        "slot_duration", "capacity", "requires_approval", "is_active",
        "disable_type", "disabled_reason", "disabled_from", "disabled_until",
      ],
      order: [["is_active", "DESC"], ["name", "ASC"]],
    });
    res.json({ success: true, data: amenities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   GET AVAILABILITY
═══════════════════════════════════════════ */
exports.getAmenityAvailability = async (req, res) => {
  try {
    const { id }   = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: "Date is required" });

    const amenity = await Amenity.findByPk(id);
    if (!amenity) return res.status(404).json({ message: "Amenity not found" });
    if (!amenity.is_active)
      return res.status(403).json({ success: false, message: "This amenity is currently unavailable." });

    /* FULL DAY */
    if (amenity.booking_type === "FULL_DAY") {
      const bookings = await AmenityBooking.findAll({
        where: {
          amenity_id: id,
          status: { [Op.in]: ["APPROVED", "PENDING", "PAYMENT_PENDING"] },
        },
        attributes: ["date"],
      });
      const bookedDates = bookings.map((b) => b.date);
      return res.json({
        success: true,
        booking_type: "FULL_DAY",
        bookedDates,
        data: [{ available: !bookedDates.includes(date) }],
      });
    }

    /* SLOT BASED */
    const { opening_time, closing_time, slot_duration } = amenity;
    const start = new Date(`1970-01-01T${opening_time}`);
    const end   = new Date(`1970-01-01T${closing_time}`);
    const slots = [];

    while (start < end) {
      const slotStart      = new Date(start);
      const slotEnd        = new Date(start.getTime() + slot_duration * 60000);
      const formattedStart = slotStart.toTimeString().slice(0, 8);
      const formattedEnd   = slotEnd.toTimeString().slice(0, 8);

      // Count both APPROVED and PAYMENT_PENDING (held slots)
      const existing = await AmenityBooking.count({
        where: {
          amenity_id: id,
          date,
          start_time: formattedStart,
          status: { [Op.in]: ["APPROVED", "PENDING", "PAYMENT_PENDING"] },
        },
      });

      slots.push({
        start_time: formattedStart,
        end_time:   formattedEnd,
        available:  existing < amenity.capacity,
      });

      start.setMinutes(start.getMinutes() + slot_duration);
    }

    res.json({ success: true, data: slots });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════════
   CREATE BOOKING
   - FREE  → immediate APPROVED / PENDING
   - PAID  → PAYMENT_PENDING + Razorpay order
═══════════════════════════════════════════ */
exports.createBooking = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { amenityId, date, startTime } = req.body;
    const userId    = req.user.id;
    const societyId = req.user.society_id;
    const userName  = req.user.name;

    if (!amenityId || !date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "amenityId and date are required." });
    }

    const amenity = await Amenity.findByPk(amenityId);
    if (!amenity) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Amenity not found." });
    }
    if (!amenity.is_active) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "This amenity is currently unavailable for booking." });
    }

    const flatId = await getUserFlatId(userId);

    const adminUser = await User.findOne({
      where: { society_id: societyId, role: "SOCIETY_ADMIN" },
      attributes: ["id", "fcm_token"],
      transaction: t,
    });
    if (!adminUser) {
      await t.rollback();
      return res.status(500).json({ success: false, message: "Society admin not found." });
    }

    /* ── Slot collision check (row-level lock) ── */
    const activeStatuses = ["APPROVED", "PENDING", "PAYMENT_PENDING"];

    if (amenity.booking_type === "FULL_DAY") {
      const existing = await AmenityBooking.count({
        where: { amenity_id: amenityId, date, status: { [Op.in]: activeStatuses } },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (existing >= amenity.capacity) {
        await t.rollback();
        return res.status(409).json({ success: false, message: "This date is already fully booked." });
      }
    } else {
      if (!startTime) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "startTime is required for slot-based bookings." });
      }
      const conflicts = await AmenityBooking.count({
        where: { amenity_id: amenityId, date, start_time: startTime, status: { [Op.in]: activeStatuses } },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (conflicts >= amenity.capacity) {
        await t.rollback();
        return res.status(409).json({ success: false, message: "This slot is fully booked." });
      }
    }

    const endTime = amenity.booking_type === "SLOT"
      ? addMinutes(startTime, amenity.slot_duration)
      : "23:59:59";

    /* ══════════════════════════
       FREE AMENITY
    ══════════════════════════ */
    if (amenity.type === "FREE") {
      const bookingStatus = amenity.requires_approval ? "PENDING" : "APPROVED";

      const booking = await AmenityBooking.create({
        society_id:     societyId,
        amenity_id:     amenityId,
        user_id:        userId,
        flat_id:        flatId,
        date,
        start_time:     startTime || "00:00:00",
        end_time:       endTime,
        status:         bookingStatus,
        payment_status: "NA",
      }, { transaction: t });

      if (amenity.requires_approval) {
        await notifyAdmin(
          adminUser,
          "Booking Approval Required",
          `⏳ ${userName} is waiting for approval for ${amenity.name} on ${date}${startTime ? " (" + startTime + ")" : ""}.`,
          "/admin/amenities",
          societyId,
          t
        );
      }

      await t.commit();
      return res.status(201).json({ success: true, data: booking, requiresPayment: false });
    }

    /* ══════════════════════════
       PAID AMENITY
       1. Create booking as PAYMENT_PENDING
       2. Create Razorpay order
       3. Return both to frontend
    ══════════════════════════ */
    const amountPaise = Math.round(Number(amenity.rate_per_hour) * 100); // Razorpay uses paise

    // Create booking row first (holds the slot)
    const booking = await AmenityBooking.create({
      society_id:         societyId,
      amenity_id:         amenityId,
      user_id:            userId,
      flat_id:            flatId,
      date,
      start_time:         startTime || "00:00:00",
      end_time:           endTime,
      status:             "PAYMENT_PENDING",
      payment_status:     "PENDING",
      payment_expires_at: paymentExpiresAt(),
    }, { transaction: t });

    // Create Razorpay order
    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create({
        amount:   amountPaise,
        currency: "INR",
        receipt:  `booking_${booking.id}`,
        notes: {
          booking_id:  String(booking.id),
          amenity:     amenity.name,
          date,
          resident:    userName,
          society_id:  String(societyId),
        },
      });
    } catch (rzErr) {
      // If Razorpay fails, rollback slot hold so user can retry
      await t.rollback();
      console.error("[Razorpay createOrder]", rzErr);
      return res.status(502).json({ success: false, message: "Payment gateway unavailable. Please try again." });
    }

    // Store order ID on booking
    await booking.update(
      { razorpay_order_id: razorpayOrder.id },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      success: true,
      data: booking,
      requiresPayment: true,
      razorpayOrder: {
        id:          razorpayOrder.id,
        amount:      razorpayOrder.amount,
        currency:    razorpayOrder.currency,
        key:         process.env.RAZORPAY_KEY_ID,
        booking_id:  booking.id,
        amenity_name: amenity.name,
        description: `${amenity.name} — ${date}`,
        prefill: {
          name:  userName,
          email: req.user.email  || "",
          contact: req.user.phone || "",
        },
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("[createBooking]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   VERIFY PAYMENT  (called by frontend after checkout success)
   Validates Razorpay HMAC signature — NEVER trust client-side success alone.
═══════════════════════════════════════════ */
exports.verifyPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      booking_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Missing payment verification fields." });
    }

    /* 1. Verify HMAC signature */
    const expectedSig = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSig !== razorpay_signature) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Payment signature verification failed." });
    }

    /* 2. Load booking */
    const booking = await AmenityBooking.findOne({
      where: {
        id:                booking_id,
        user_id:           req.user.id,
        razorpay_order_id: razorpay_order_id,
        status:            "PAYMENT_PENDING",
      },
      transaction: t,
      lock:        t.LOCK.UPDATE,
    });

    if (!booking) {
      await t.rollback();
      // Could be already processed (idempotency) or expired
      const existing = await AmenityBooking.findByPk(booking_id);
      if (existing && ["APPROVED", "PENDING"].includes(existing.status)) {
        return res.json({ success: true, alreadyProcessed: true, data: existing });
      }
      return res.status(404).json({ success: false, message: "Booking not found or payment window expired." });
    }

    /* 3. Check it hasn't expired */
    if (booking.payment_expires_at && new Date() > new Date(booking.payment_expires_at)) {
      await booking.update({
        status:         "CANCELLED",
        payment_status: "FAILED",
      }, { transaction: t });
      await t.commit();
      return res.status(410).json({ success: false, message: "Payment window expired. Please book again." });
    }

    /* 4. Load amenity to determine next status */
    const amenity = await Amenity.findByPk(booking.amenity_id);
    const nextStatus = amenity?.requires_approval ? "PENDING" : "APPROVED";

    /* 5. Confirm booking */
    await booking.update({
      status:              nextStatus,
      payment_status:      "PAID",
      razorpay_payment_id: razorpay_payment_id,
      payment_expires_at:  null, // clear expiry — slot is confirmed
    }, { transaction: t });

    /* 6. Notify admin if approval required */
    if (amenity?.requires_approval) {
      const adminUser = await User.findOne({
        where: { society_id: req.user.society_id, role: "SOCIETY_ADMIN" },
        attributes: ["id", "fcm_token"],
        transaction: t,
      });
      if (adminUser) {
        await notifyAdmin(
          adminUser,
          "Booking Approval Required",
          `⏳ ${req.user.name} paid for ${amenity.name} on ${booking.date} and is awaiting approval.`,
          "/admin/amenities",
          req.user.society_id,
          t
        );
      }
    }

    await t.commit();

    /* 7. Notify resident of confirmation */
    notifyResident(
      req.user.id,
      nextStatus === "APPROVED" ? "Booking Confirmed ✅" : "Payment Received — Awaiting Approval ⏳",
      nextStatus === "APPROVED"
        ? `Your booking for ${amenity?.name} on ${booking.date} is confirmed.`
        : `Payment received for ${amenity?.name} on ${booking.date}. Waiting for admin approval.`,
      req.user.society_id
    ).catch(console.error);

    res.json({ success: true, data: await AmenityBooking.findByPk(booking.id) });
  } catch (error) {
    await t.rollback();
    console.error("[verifyPayment]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   REPAY  — create a new Razorpay order for an existing PAYMENT_PENDING booking
   Resets the 15-min window so the user gets a full session.
═══════════════════════════════════════════ */
exports.repayBooking = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const booking = await AmenityBooking.findOne({
      where: { id, user_id: req.user.id, status: "PAYMENT_PENDING" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!booking) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "No pending payment found for this booking." });
    }

    const amenity = await Amenity.findByPk(booking.amenity_id);
    if (!amenity || !amenity.is_active) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Amenity is no longer available." });
    }

    const amountPaise = Math.round(Number(amenity.rate_per_hour) * 100);

    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create({
        amount:   amountPaise,
        currency: "INR",
        receipt:  `repay_${booking.id}_${Date.now()}`,
        notes: {
          booking_id: String(booking.id),
          amenity:    amenity.name,
          date:       booking.date,
          resident:   req.user.name,
        },
      });
    } catch (rzErr) {
      await t.rollback();
      console.error("[Razorpay repay order]", rzErr);
      return res.status(502).json({ success: false, message: "Payment gateway unavailable. Please try again." });
    }

    // Reset expiry window and store new order ID
    await booking.update({
      razorpay_order_id:  razorpayOrder.id,
      razorpay_payment_id: null,
      payment_expires_at: paymentExpiresAt(),
    }, { transaction: t });

    await t.commit();

    return res.json({
      success: true,
      razorpayOrder: {
        id:           razorpayOrder.id,
        amount:       razorpayOrder.amount,
        currency:     razorpayOrder.currency,
        key:          process.env.RAZORPAY_KEY_ID,
        booking_id:   booking.id,
        amenity_name: amenity.name,
        description:  `${amenity.name} — ${booking.date}`,
        prefill: {
          name:    req.user.name,
          email:   req.user.email   || "",
          contact: req.user.phone   || "",
        },
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("[repayBooking]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   GET MY BOOKINGS  (includes PAYMENT_PENDING for repay UI)
═══════════════════════════════════════════ */
exports.getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const flatId = await getUserFlatId(userId);
    const baseWhere = flatId ? { flat_id: flatId } : { user_id: userId };

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search      = req.query.search?.trim()      || "";
    const filter      = req.query.filter              || "ALL";
    const amenityName = req.query.amenityName?.trim() || "";

    const where = { ...baseWhere };
    if (filter !== "ALL") where.status = filter;

    const amenityWhere = {};
    if (amenityName && amenityName !== "ALL") amenityWhere.name = amenityName;
    if (search) amenityWhere.name = { [Op.like]: `%${search}%` };

    const { count, rows: bookings } = await AmenityBooking.findAndCountAll({
      where,
      include: [{
        model:    Amenity,
        required: !!(amenityName && amenityName !== "ALL") || !!search,
        where:    Object.keys(amenityWhere).length ? amenityWhere : undefined,
      }],
      order:    [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    // Count per-status (always over full base set, no filter)
    const [totalAll, totalPaymentPending, totalPending, totalApproved, totalCancelled, totalRejected] =
      await Promise.all([
        AmenityBooking.count({ where: baseWhere }),
        AmenityBooking.count({ where: { ...baseWhere, status: "PAYMENT_PENDING" } }),
        AmenityBooking.count({ where: { ...baseWhere, status: "PENDING"         } }),
        AmenityBooking.count({ where: { ...baseWhere, status: "APPROVED"        } }),
        AmenityBooking.count({ where: { ...baseWhere, status: "CANCELLED"       } }),
        AmenityBooking.count({ where: { ...baseWhere, status: "REJECTED"        } }),
      ]);

    const allBookings = await AmenityBooking.findAll({
      where: baseWhere,
      include: [{ model: Amenity, attributes: ["name"] }],
      attributes: ["id"],
    });
    const amenityNames = [...new Set(allBookings.map((b) => b.Amenity?.name).filter(Boolean))];

    res.json({
      success: true,
      data: bookings,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        ALL:             totalAll,
        PAYMENT_PENDING: totalPaymentPending,
        PENDING:         totalPending,
        APPROVED:        totalApproved,
        CANCELLED:       totalCancelled,
        REJECTED:        totalRejected,
      },
      amenityNames,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   CANCEL  (resident-initiated)
   Only allowed for PAYMENT_PENDING, PENDING, APPROVED.
═══════════════════════════════════════════ */
exports.cancelBooking = async (req, res) => {
  try {
    const booking = await AmenityBooking.findOne({
      where: {
        id:      req.params.id,
        user_id: req.user.id,
        status:  { [Op.in]: ["PAYMENT_PENDING", "PENDING", "APPROVED"] },
      },
    });
    if (!booking)
      return res.status(404).json({ success: false, message: "Booking not found or cannot be cancelled." });

    await booking.update({
      status:         "CANCELLED",
      payment_status: booking.payment_status === "PAID" ? "PAID" : "FAILED",
      payment_expires_at: null,
    });

    res.json({ success: true, message: "Booking cancelled." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   GET BOOKED DATES  (for FULL_DAY calendar)
═══════════════════════════════════════════ */
exports.getBookedDates = async (req, res) => {
  try {
    const { id } = req.params;
    const bookings = await AmenityBooking.findAll({
      where: {
        amenity_id: id,
        status: { [Op.in]: ["APPROVED", "PENDING", "PAYMENT_PENDING"] },
      },
      attributes: ["date"],
    });
    res.json({ success: true, data: bookings.map((b) => b.date) });
  } catch (err) {
    console.error("[getBookedDates]", err);
    res.status(500).json({ message: "Server error" });
  }
};