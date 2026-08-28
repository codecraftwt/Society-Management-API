

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
const { sendPushNotification } = require("../utils/pushNotification");
const { groupAmenityBookings } = require("../utils/groupAmenityBookings");

/* ─── Demo UPI payment helper ─── */
function buildUpiPaymentData(amenity, bookingId, totalAmount, allBookingIds) {
  const upiId   = process.env.DEMO_UPI_ID   || "society@upi";
  const upiName = process.env.DEMO_UPI_NAME || "Society Payment";
  const amount  = totalAmount ?? (Number(amenity.rate_per_hour) || 0);
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount}&cu=INR`;
  const payload = { upiId, upiName, amount, upiLink, booking_id: bookingId };
  if (Array.isArray(allBookingIds) && allBookingIds.length > 0) {
    payload.all_booking_ids = allBookingIds;
    payload.count = allBookingIds.length;
  }
  return payload;
}

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
   - PAID  → PAYMENT_PENDING + UPI payment details
═══════════════════════════════════════════ */
exports.createBooking = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { amenityId, date, startTime, bookings: rawBookings } = req.body;
    const userId    = req.user.id;
    const societyId = req.user.society_id;
    const userName  = req.user.name;

    if (!amenityId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "amenityId is required." });
    }

    const hasMulti = Array.isArray(rawBookings) && rawBookings.length > 0;
    if (!date && !hasMulti) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "amenityId and date are required." });
    }

    /* ── Normalize bookings list (multi-booking support) ── */
    let bookingList;
    if (hasMulti) {
      const seen = new Set();
      bookingList = [];
      for (const b of rawBookings) {
        if (!b || !b.date) continue;
        const bTime = b.startTime || null;
        const key = `${b.date}|${bTime || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bookingList.push({ date: b.date, startTime: bTime });
      }
      if (bookingList.length === 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "bookings must contain at least one valid { date } entry." });
      }
    } else {
      bookingList = [{ date, startTime: startTime || null }];
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

    const checkConflict = async (b) => {
      if (amenity.booking_type === "FULL_DAY") {
        const existing = await AmenityBooking.count({
          where: { amenity_id: amenityId, date: b.date, status: { [Op.in]: activeStatuses } },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (existing >= amenity.capacity) {
          return `This date (${b.date}) is already fully booked.`;
        }
      } else {
        if (!b.startTime) {
          return `startTime is required for slot-based bookings on ${b.date}.`;
        }
        const conflicts = await AmenityBooking.count({
          where: { amenity_id: amenityId, date: b.date, start_time: b.startTime, status: { [Op.in]: activeStatuses } },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (conflicts >= amenity.capacity) {
          return `The ${b.startTime} slot on ${b.date} is fully booked.`;
        }
      }
      return null;
    };

    const endTimeFor = (b) => amenity.booking_type === "SLOT"
      ? addMinutes(b.startTime, amenity.slot_duration)
      : "23:59:59";

    for (const b of bookingList) {
      const conflictMsg = await checkConflict(b);
      if (conflictMsg) {
        await t.rollback();
        return res.status(409).json({ success: false, message: conflictMsg });
      }
    }

    /* ══════════════════════════
       FREE AMENITY
    ══════════════════════════ */
    if (amenity.type === "FREE") {
      const bookingStatus = amenity.requires_approval ? "PENDING" : "APPROVED";
      const rows = [];

      for (const b of bookingList) {
        const row = await AmenityBooking.create({
          society_id:     societyId,
          amenity_id:     amenityId,
          user_id:        userId,
          flat_id:        flatId,
          date:           b.date,
          start_time:     b.startTime || "00:00:00",
          end_time:       endTimeFor(b),
          status:         bookingStatus,
          payment_status: "NA",
        }, { transaction: t });
        rows.push(row);
      }

      if (amenity.requires_approval) {
        const detail = bookingList.map((b) => `${b.date}${b.startTime ? " (" + b.startTime + ")" : ""}`).join(", ");
        await notifyAdmin(
          adminUser,
          "Booking Approval Required",
          `⏳ ${userName} is waiting for approval for ${amenity.name}: ${detail}.`,
          "/admin/amenities",
          societyId,
          t
        );
      }

      await t.commit();
      return res.status(201).json({ success: true, data: rows[0], bookings: rows, requiresPayment: false });
    }

    /* ══════════════════════════
       PAID AMENITY (Demo UPI)
       1. Create booking as PAYMENT_PENDING
       2. Return society UPI details for QR code
    ══════════════════════════ */
    const paymentExpiry = paymentExpiresAt();
    const rows = [];

    for (const b of bookingList) {
      const row = await AmenityBooking.create({
        society_id:         societyId,
        amenity_id:         amenityId,
        user_id:            userId,
        flat_id:            flatId,
        date:               b.date,
        start_time:         b.startTime || "00:00:00",
        end_time:           endTimeFor(b),
        status:             "PAYMENT_PENDING",
        payment_status:     "PENDING",
        payment_expires_at: paymentExpiry,
      }, { transaction: t });
      rows.push(row);
    }

    await t.commit();

    const allBookingIds = rows.map((r) => r.id);
    const totalAmount   = (Number(amenity.rate_per_hour) || 0) * bookingList.length;
    const upiPayment    = buildUpiPaymentData(amenity, rows[0].id, totalAmount, allBookingIds);

    return res.status(201).json({
      success: true,
      data: rows[0],
      bookings: rows,
      requiresPayment: true,
      upiPayment,
    });
  } catch (error) {
    await t.rollback();
    console.error("[createBooking]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   VERIFY PAYMENT  (demo mode — instant confirm)
   Frontend calls this after user taps "I have paid".
═══════════════════════════════════════════ */
exports.verifyPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { booking_id, booking_ids } = req.body;

    let ids = [];
    if (Array.isArray(booking_ids) && booking_ids.length) {
      ids = booking_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
    } else if (booking_id) {
      ids = [Number(booking_id)].filter((n) => Number.isFinite(n) && n > 0);
    }

    if (ids.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "booking_id is required." });
    }

    ids = [...new Set(ids)];

    /* 1. Load all bookings (same user only) */
    const bookings = await AmenityBooking.findAll({
      where: { id: { [Op.in]: ids }, user_id: req.user.id },
      transaction: t,
      lock:        t.LOCK.UPDATE,
    });

    if (bookings.length === 0) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Booking not found or payment window expired." });
    }

    /* 2. All requested ids must resolve and belong to this user */
    if (bookings.length !== ids.length) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "One or more bookings were not found." });
    }

    /* 3. Partition by status (atomic — nothing updated until all pass) */
    const pending = bookings.filter((b) => b.status === "PAYMENT_PENDING");
    const already = bookings.filter((b) => ["APPROVED", "PENDING"].includes(b.status));
    const invalid = bookings.filter(
      (b) => b.status !== "PAYMENT_PENDING" && !["APPROVED", "PENDING"].includes(b.status)
    );

    if (invalid.length > 0) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "One or more bookings are cancelled or rejected and cannot be confirmed." });
    }

    /* 4. No pending left — already processed */
    if (pending.length === 0) {
      await t.commit();
      return res.json({ success: true, alreadyProcessed: true, data: already[0] });
    }

    /* 5. Expiry check for every pending booking */
    const expired = pending.filter((b) => b.payment_expires_at && new Date() > new Date(b.payment_expires_at));
    if (expired.length > 0) {
      await Promise.all(expired.map((b) => b.update({ status: "CANCELLED", payment_status: "FAILED" }, { transaction: t })));
      await t.commit();
      return res.status(410).json({ success: false, message: "Payment window expired. Please book again." });
    }

    /* 6. Load amenity to determine next status */
    const amenity = await Amenity.findByPk(pending[0].amenity_id);
    const nextStatus = amenity?.requires_approval ? "PENDING" : "APPROVED";

    /* 7. Confirm ALL pending bookings together */
    for (const b of pending) {
      await b.update({
        status:             nextStatus,
        payment_status:     "PAID",
        payment_expires_at: null,
      }, { transaction: t });
    }

    /* 8. Notify admin once (if approval required) */
    if (amenity?.requires_approval) {
      const adminUser = await User.findOne({
        where: { society_id: req.user.society_id, role: "SOCIETY_ADMIN" },
        attributes: ["id", "fcm_token"],
        transaction: t,
      });
      if (adminUser) {
        const detail = pending.map((b) => `${b.date}${b.start_time && b.start_time !== "00:00:00" ? " " + b.start_time.slice(0, 5) : ""}`).join(", ");
        await notifyAdmin(
          adminUser,
          "Booking Approval Required",
          `⏳ ${req.user.name} paid for ${amenity.name} (${pending.length} booking${pending.length > 1 ? "s" : ""}): ${detail}. Awaiting approval.`,
          "/admin/amenities",
          req.user.society_id,
          t
        );
      }
    }

    await t.commit();

    /* 9. Notify resident once */
    notifyResident(
      req.user.id,
      nextStatus === "APPROVED" ? "Booking Confirmed ✅" : "Payment Received — Awaiting Approval ⏳",
      nextStatus === "APPROVED"
        ? `Your booking(s) for ${amenity?.name} (${pending.length}) are confirmed.`
        : `Payment received for ${amenity?.name} (${pending.length} booking${pending.length > 1 ? "s" : ""}). Waiting for admin approval.`,
      req.user.society_id
    ).catch(console.error);

    res.json({ success: true, data: await AmenityBooking.findByPk(pending[0].id) });
  } catch (error) {
    await t.rollback();
    console.error("[verifyPayment]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   REPAY  — return UPI payment data for an existing PAYMENT_PENDING booking
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

    // Reset expiry window
    await booking.update({ payment_expires_at: paymentExpiresAt() }, { transaction: t });
    await t.commit();

    const upiPayment = buildUpiPaymentData(amenity, booking.id);

    return res.json({ success: true, upiPayment });
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
    const allBookings = await AmenityBooking.findAll({
      where: baseWhere,
      include: [{ model: Amenity, attributes: ["name"] }],
    });
    // Group the FULL dataset so counts / totals reflect merged bookings
    // (a multi-day or multi-slot booking is 1 record, not N rows).
    const allGrouped = groupAmenityBookings(allBookings);
    const totalItems = allGrouped.length;
    const counts = allGrouped.reduce((acc, b) => {
      const st = b.status || "UNKNOWN";
      acc[st] = (acc[st] || 0) + 1;
      acc.ALL = (acc.ALL || 0) + 1;
      return acc;
    }, {});
    const amenityNames = [...new Set(allBookings.map((b) => b.Amenity?.name).filter(Boolean))];

    // Group full‑day amenity bookings so a multi‑day booking (e.g. 28–31)
    // shows as ONE record with a from → to date range.
    const grouped = groupAmenityBookings(bookings);

    res.json({
        success: true,
        data: grouped,
        pagination: {
          currentPage: page,
          totalPages:  Math.ceil(totalItems / limit),
          totalItems,
          limit,
        },
        counts,
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
    const ids = req.body?.booking_ids?.length
      ? req.body.booking_ids
      : [req.params.id];

    const bookings = await AmenityBooking.findAll({
      where: {
        id:      { [Op.in]: ids },
        user_id: req.user.id,
        status:  { [Op.in]: ["PAYMENT_PENDING", "PENDING", "APPROVED"] },
      },
    });
    if (!bookings.length)
      return res.status(404).json({ success: false, message: "Booking not found or cannot be cancelled." });

    await Promise.all(bookings.map((b) => b.update({
      status:             "CANCELLED",
      payment_status:     b.payment_status === "PAID" ? "PAID" : "FAILED",
      payment_expires_at: null,
    })));

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