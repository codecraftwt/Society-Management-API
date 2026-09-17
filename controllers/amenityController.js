

const {
  Amenity,
  AmenityBooking,
  User,
  Flat,
  HouseHoldMember,
  Notification,
  Payment,
  LedgerEntry,
  sequelize,
} = require("../models");

const { Op }                   = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");
const { groupAmenityBookings } = require("../utils/groupAmenityBookings");
const { createLedgerEntry, reverseLedgerEntry } = require("../utils/ledgerService");

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

/* ─── Date helpers (avoid tz drift by using manual YYYY-MM-DD) ─── */
const parseISO = (iso) => {
  if (!iso) return new Date(0);
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const eachDate = (fromIso, toIso) => {
  const out = [];
  const cur = parseISO(fromIso);
  const end = parseISO(toIso);
  while (cur <= end) {
    out.push(fmtISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const diffDays = (fromIso, toIso) =>
  Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000) + 1;

/* How many billable units a booking represents */
const bookingUnits = (b) => {
  if (!b) return 1;
  if (Array.isArray(b.slots) && b.slots.length) return b.slots.length;
  return diffDays(b.from_date || b.date, b.to_date || b.date);
};

/* Total payable amount for a booking = rate_per_hour × billable units */
const bookingAmount = (amenity, b) => {
  const rate = Number(amenity?.rate_per_hour) || Number(b?.rate_per_hour) || 0;
  return rate * bookingUnits(b);
};

/* Human-readable date range or slot summary for notification strings */
const dateRangeLabel = (b) => {
  const from = b.from_date || b.date;
  const to   = b.to_date;
  if (to && to !== from) return `${from} – ${to}`;
  return String(from);
};
const slotLabel = (b) => {
  if (Array.isArray(b.slots) && b.slots.length) {
    return `${b.slots.length} slot${b.slots.length > 1 ? "s" : ""}`;
  }
  if (b.start_time && b.start_time !== "00:00:00") {
    const end = b.end_time && b.end_time !== "23:59:59" ? ` – ${b.end_time.slice(0, 5)}` : "";
    return `${b.start_time.slice(0, 5)}${end}`;
  }
  return null;
};

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
═════════════════════════════════════════ */
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
═════════════════════════════════════════ */
exports.getAmenityAvailability = async (req, res) => {
  try {
    const { id }   = req.params;
    const { date, from_date, to_date } = req.query;
    if (!date && !from_date) return res.status(400).json({ message: "date is required when from_date is not provided" });

    const amenity = await Amenity.findByPk(id);
    if (!amenity) return res.status(404).json({ message: "Amenity not found" });
    if (!amenity.is_active)
      return res.status(403).json({ success: false, message: "This amenity is currently unavailable." });

    const activeStatuses = ["APPROVED", "PENDING", "PAYMENT_PENDING"];

    /* FULL DAY */
    if (amenity.booking_type === "FULL_DAY") {
      const bookings = await AmenityBooking.findAll({
        where: {
          amenity_id: id,
          status: { [Op.in]: activeStatuses },
        },
        attributes: ["from_date", "to_date", "date"],
      });
      const bookedSet = new Set();
      for (const b of bookings) {
        const effFrom = b.from_date || b.date;
        const effTo   = b.to_date   || b.date;
        eachDate(effFrom, effTo).forEach((d) => bookedSet.add(d));
      }
      const bookedDates = [...bookedSet];
      const dates = from_date ? eachDate(from_date, to_date || from_date) : [date];
      return res.json({
        success: true,
        booking_type: "FULL_DAY",
        bookedDates,
        data: dates.map((d) => ({ date: d, available: !bookedDates.includes(d) })),
      });
    }

    /* SLOT BASED */
    const { opening_time, closing_time, slot_duration } = amenity;
    const dates = from_date ? eachDate(from_date, to_date || from_date) : [date];

    /* Fetch all active bookings overlapping any queried date */
    const qFrom = dates[0];
    const qTo   = dates[dates.length - 1];
    const overlapping = await AmenityBooking.findAll({
      where: {
        amenity_id: id,
        status: { [Op.in]: activeStatuses },
        [Op.or]: [
          { from_date: { [Op.lte]: qTo }, to_date: { [Op.gte]: qFrom } },
          { from_date: null, date: { [Op.between]: [qFrom, qTo] } },
        ],
      },
      attributes: ["id", "date", "start_time", "end_time", "slots"],
    });

    const slots = [];
    for (const d of dates) {
      const start = new Date(`1970-01-01T${opening_time}`);
      const end   = new Date(`1970-01-01T${closing_time}`);
      while (start < end) {
        const slotStart      = new Date(start);
        const slotEnd        = new Date(start.getTime() + slot_duration * 60000);
        const formattedStart = slotStart.toTimeString().slice(0, 8);
        const formattedEnd   = slotEnd.toTimeString().slice(0, 8);

        const matchKey = `${d}|${formattedStart}`;
        let count = 0;
        for (const b of overlapping) {
          if (Array.isArray(b.slots) && b.slots.length) {
            if (b.slots.some((s) => `${s.date}|${s.start_time}` === matchKey)) count++;
          } else if (b.date === d && b.start_time < formattedEnd && b.end_time > formattedStart) {
            count++;
          }
        }

        slots.push({
          date:       d,
          start_time: formattedStart,
          end_time:   formattedEnd,
          available:  count < amenity.capacity,
        });

        start.setMinutes(start.getMinutes() + slot_duration);
      }
    }

    res.json({ success: true, data: slots });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════════
   CREATE BOOKING
   One row per reservation.
   NEW PAYLOADS:
     FULL_DAY  { amenityId, from_date, to_date }
     SLOT      { amenityId, from_date, to_date, slots:[{date,start_time}] }
   LEGACY (still accepted):
     { amenityId, bookings:[{date, startTime}] }
═════════════════════════════════════════ */
exports.createBooking = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { amenityId, date, startTime, bookings: rawBookings, from_date, to_date, slots: rawSlots } = req.body;
    const userId    = req.user.id;
    const societyId = req.user.society_id;
    const userName  = req.user.name;

    if (!amenityId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "amenityId is required." });
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

    /* ── Normalize into { fromDate, toDate, slotList } ── */
    let fromDate, toDate;
    let slotList = null; // null for FULL_DAY; [{date, start_time, end_time}] for SLOT

    const isFullDay = amenity.booking_type === "FULL_DAY";

    if (isFullDay) {
      /* FULL_DAY — prefer new payload, fall back to bookings[] */
      if (from_date && to_date) {
        fromDate = from_date;
        toDate   = to_date;
        if (parseISO(fromDate) > parseISO(toDate)) {
          await t.rollback();
          return res.status(400).json({ success: false, message: "from_date must not be after to_date." });
        }
      } else {
        const list = Array.isArray(rawBookings) && rawBookings.length > 0 ? rawBookings : (date ? [{ date, startTime }] : []);
        if (!list.length) {
          await t.rollback();
          return res.status(400).json({ success: false, message: "amenityId and date(s) are required." });
        }
        const dates = [...new Set(list.map((b) => b?.date).filter(Boolean))].sort();
        if (!dates.length) {
          await t.rollback();
          return res.status(400).json({ success: false, message: "bookings must contain at least one valid date entry." });
        }
        fromDate = dates[0];
        toDate   = dates[dates.length - 1];
      }
    } else {
      /* SLOT — prefer new payload, fall back to bookings[] */
      if (Array.isArray(rawSlots) && rawSlots.length > 0) {
        slotList = rawSlots.map((s) => ({ date: s.date, start_time: s.start_time }));
      } else if (Array.isArray(rawBookings) && rawBookings.length > 0) {
        slotList = rawBookings.map((b) => ({ date: b.date, start_time: b.startTime || b.start_time }));
      } else if (date && (startTime || req.body.start_time)) {
        slotList = [{ date, start_time: startTime || req.body.start_time }];
      }

      if (!slotList || slotList.length === 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "SLOT bookings require slots or bookings entries." });
      }

      /* Deduplicate */
      const seen = new Set();
      slotList = slotList.filter((s) => {
        if (!s?.date || !s.start_time) return false;
        const key = `${s.date}|${s.start_time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!slotList.length) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "No valid unique slots provided." });
      }

      const dates = [...new Set(slotList.map((s) => s.date))].sort();
      fromDate = dates[0];
      toDate   = dates[dates.length - 1];

      /* Compute end_time for each slot */
      slotList = slotList.map((s) => ({
        date: s.date,
        start_time: s.start_time,
        end_time: addMinutes(s.start_time, amenity.slot_duration),
      }));
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

    /* ── Conflict check ── */
    const activeStatuses = ["APPROVED", "PENDING", "PAYMENT_PENDING"];

    if (isFullDay) {
      const overlapping = await AmenityBooking.findAll({
        where: {
          amenity_id: amenityId,
          status: { [Op.in]: activeStatuses },
          [Op.or]: [
            { from_date: { [Op.lte]: toDate }, to_date: { [Op.gte]: fromDate } },
            { from_date: null, date: { [Op.between]: [fromDate, toDate] } },
          ],
        },
        attributes: ["id", "from_date", "to_date", "date"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const dayOccupancy = {};
      for (const b of overlapping) {
        const effFrom = b.from_date || b.date;
        const effTo   = b.to_date   || b.date;
        for (const d of eachDate(effFrom, effTo)) {
          dayOccupancy[d] = (dayOccupancy[d] || 0) + 1;
        }
      }
      const fullDay = eachDate(fromDate, toDate).find((d) => (dayOccupancy[d] || 0) >= amenity.capacity);
      if (fullDay) {
        await t.rollback();
        return res.status(409).json({ success: false, message: `This date (${fullDay}) is already fully booked.` });
      }
    } else {
      const overlapping = await AmenityBooking.findAll({
        where: {
          amenity_id: amenityId,
          status: { [Op.in]: activeStatuses },
          [Op.or]: [
            { from_date: { [Op.lte]: toDate }, to_date: { [Op.gte]: fromDate } },
            { from_date: null, date: { [Op.between]: [fromDate, toDate] } },
          ],
        },
        attributes: ["id", "date", "slots", "start_time", "end_time"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      for (const s of slotList) {
        const matchKey = `${s.date}|${s.start_time}`;
        let count = 0;
        for (const b of overlapping) {
          if (Array.isArray(b.slots) && b.slots.length) {
            if (b.slots.some((x) => `${x.date}|${x.start_time}` === matchKey)) count++;
          } else if (b.date === s.date && b.start_time < s.end_time && b.end_time > s.start_time) {
            count++;
          }
        }
        if (count >= amenity.capacity) {
          await t.rollback();
          return res.status(409).json({ success: false, message: `The ${s.start_time} slot on ${s.date} is fully booked.` });
        }
      }
    }

    /* ════════════════════════════
       FREE AMENITY
    ════════════════════════════ */
    if (amenity.type === "FREE") {
      const bookingStatus = amenity.requires_approval ? "PENDING" : "APPROVED";
      const endTime      = isFullDay ? "23:59:59" : slotList[slotList.length - 1].end_time;
      const startTimeVal = isFullDay ? "00:00:00" : slotList[0].start_time;

      const row = await AmenityBooking.create({
        society_id:     societyId,
        amenity_id:     amenityId,
        user_id:        userId,
        flat_id:        flatId,
        date:           fromDate,
        from_date:      fromDate,
        to_date:        toDate,
        slots:          slotList,
        start_time:     startTimeVal,
        end_time:       endTime,
        status:         bookingStatus,
        payment_status: "NA",
      }, { transaction: t });

      if (amenity.requires_approval) {
        const detail = isFullDay ? `${fromDate} – ${toDate}` : slotLabel({ slots: slotList });
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
      return res.status(201).json({ success: true, data: row, bookings: [row], requiresPayment: false });
    }

    /* ════════════════════════════
       PAID AMENITY (Demo UPI)
    ════════════════════════════ */
    const paymentExpiry = paymentExpiresAt();
    const endTime      = isFullDay ? "23:59:59" : slotList[slotList.length - 1].end_time;
    const startTimeVal = isFullDay ? "00:00:00" : slotList[0].start_time;
    const unitCount    = bookingUnits({ from_date: fromDate, to_date: toDate, slots: slotList });
    const totalAmount  = (Number(amenity.rate_per_hour) || 0) * unitCount;

    const row = await AmenityBooking.create({
      society_id:         societyId,
      amenity_id:         amenityId,
      user_id:            userId,
      flat_id:            flatId,
      date:               fromDate,
      from_date:          fromDate,
      to_date:            toDate,
      slots:              slotList,
      start_time:         startTimeVal,
      end_time:           endTime,
      status:             "PAYMENT_PENDING",
      payment_status:     "PENDING",
      payment_expires_at: paymentExpiry,
    }, { transaction: t });

    await t.commit();

    const upiPayment = buildUpiPaymentData(amenity, row.id, totalAmount, [row.id]);

    return res.status(201).json({
      success: true,
      data: row,
      bookings: [row],
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
═════════════════════════════════════════ */
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

    if (bookings.length !== ids.length) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "One or more bookings were not found." });
    }

    /* 2. Partition by status */
    const pending = bookings.filter((b) => b.status === "PAYMENT_PENDING");
    const already = bookings.filter((b) => ["APPROVED", "PENDING"].includes(b.status));
    const invalid = bookings.filter(
      (b) => b.status !== "PAYMENT_PENDING" && !["APPROVED", "PENDING"].includes(b.status)
    );

    if (invalid.length > 0) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "One or more bookings are cancelled or rejected and cannot be confirmed." });
    }

    if (pending.length === 0) {
      await t.commit();
      return res.json({ success: true, alreadyProcessed: true, data: already[0] });
    }

    /* 3. Expiry check */
    const expired = pending.filter((b) => b.payment_expires_at && new Date() > new Date(b.payment_expires_at));
    if (expired.length > 0) {
      await Promise.all(expired.map((b) => b.update({ status: "CANCELLED", payment_status: "FAILED" }, { transaction: t })));
      await t.commit();
      return res.status(410).json({ success: false, message: "Payment window expired. Please book again." });
    }

    /* 4. Load amenity */
    const amenity = await Amenity.findByPk(pending[0].amenity_id);
    const nextStatus = amenity?.requires_approval ? "PENDING" : "APPROVED";

    /* 5. Confirm + record Payment & Ledger (one per booking) */
    for (const b of pending) {
      const amt = bookingAmount(amenity, b);
      await b.update({
        status:             nextStatus,
        payment_status:     "PAID",
        payment_expires_at: null,
      }, { transaction: t });

      await Payment.create({
        amenity_booking_id: b.id,
        society_id: b.society_id || req.user.society_id,
        resident_id: b.user_id,
        amount: amt,
        payment_mode: "UPI",
        source: "AMENITY",
        status: "SUCCESS",
      }, { transaction: t });

      await createLedgerEntry({
        societyId: b.society_id || req.user.society_id,
        type: "CREDIT",
        source: "AMENITY",
        referenceId: b.id,
        amount: amt,
        entryDate: b.from_date || b.date || new Date().toISOString().slice(0, 10),
        description: `Amenity payment (${amenity?.name || "Amenity"})`,
        actor: req.user,
        transaction: t,
      });
    }

    /* 6. Notify admin (if approval required) */
    if (amenity?.requires_approval) {
      const adminUser = await User.findOne({
        where: { society_id: req.user.society_id, role: "SOCIETY_ADMIN" },
        attributes: ["id", "fcm_token"],
        transaction: t,
      });
      if (adminUser) {
        const detail = pending.map((b) => `${dateRangeLabel(b)}${slotLabel(b) ? " (" + slotLabel(b) + ")" : ""}`).join(", ");
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

    /* 7. Notify resident */
    notifyResident(
      req.user.id,
      nextStatus === "APPROVED" ? "Booking Confirmed ✅" : "Payment Received — Awaiting Approval ⏳",
      nextStatus === "APPROVED"
        ? `Your booking for ${amenity?.name} is confirmed.`
        : `Payment received for ${amenity?.name}. Waiting for admin approval.`,
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
═════════════════════════════════════════ */
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

    await booking.update({ payment_expires_at: paymentExpiresAt() }, { transaction: t });
    await t.commit();

    const totalAmount = bookingAmount(amenity, booking);
    const upiPayment  = buildUpiPaymentData(amenity, booking.id, totalAmount, [booking.id]);

    return res.json({ success: true, upiPayment });
  } catch (error) {
    await t.rollback();
    console.error("[repayBooking]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   GET MY BOOKINGS  (includes PAYMENT_PENDING for repay UI)
═════════════════════════════════════════ */
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

    const allBookings = await AmenityBooking.findAll({
      where: baseWhere,
      include: [{ model: Amenity, attributes: ["name"] }],
    });
    const allGrouped = groupAmenityBookings(allBookings);
    const totalItems = allGrouped.length;
    const counts = allGrouped.reduce((acc, b) => {
      const st = b.status || "UNKNOWN";
      acc[st] = (acc[st] || 0) + 1;
      acc.ALL = (acc.ALL || 0) + 1;
      return acc;
    }, {});
    const amenityNames = [...new Set(allBookings.map((b) => b.Amenity?.name).filter(Boolean))];

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
═════════════════════════════════════════ */
exports.cancelBooking = async (req, res) => {
  const t = await sequelize.transaction();
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
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!bookings.length) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Booking not found or cannot be cancelled." });
    }

    for (const b of bookings) {
      const wasPaid = b.payment_status === "PAID";
      await b.update({
        status:             "CANCELLED",
        payment_status:     wasPaid ? "PAID" : "FAILED",
        payment_expires_at: null,
      }, { transaction: t });

      if (wasPaid) {
        const credit = await LedgerEntry.findOne({
          where: { society_id: b.society_id, source: "AMENITY", reference_id: b.id, type: "CREDIT" },
          transaction: t,
        });
        if (credit) {
          await reverseLedgerEntry({
            entry: credit,
            actor: req.user,
            reason: "Amenity booking cancelled after payment",
            transaction: t,
          });
        }
      }
    }

    await t.commit();
    res.json({ success: true, message: "Booking cancelled." });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ═══════════════════════════════════════════
   GET BOOKED DATES  (for FULL_DAY calendar)
   Expands range bookings to individual dates.
═════════════════════════════════════════ */
exports.getBookedDates = async (req, res) => {
  try {
    const { id } = req.params;
    const amenity = await Amenity.findByPk(id, { attributes: ["booking_type"] });
    const bookings = await AmenityBooking.findAll({
      where: {
        amenity_id: id,
        status: { [Op.in]: ["APPROVED", "PENDING", "PAYMENT_PENDING"] },
      },
      attributes: ["date", "from_date", "to_date", "slots"],
    });

    const dateSet = new Set();
    for (const b of bookings) {
      if (amenity?.booking_type === "SLOT") {
        if (Array.isArray(b.slots) && b.slots.length) {
          b.slots.forEach((s) => s.date && dateSet.add(s.date));
        } else {
          dateSet.add(b.date);
        }
      } else {
        const effFrom = b.from_date || b.date;
        const effTo   = b.to_date   || b.date;
        eachDate(effFrom, effTo).forEach((d) => dateSet.add(d));
      }
    }

    res.json({ success: true, data: [...dateSet].sort() });
  } catch (err) {
    console.error("[getBookedDates]", err);
    res.status(500).json({ message: "Server error" });
  }
};
