
const { Amenity, AmenityBooking, User, Flat, Notification } = require("../models");
const { Op }                   = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");
const { groupAmenityBookings } = require("../utils/groupAmenityBookings");

/* ── Time helper ── */
const addMinutes = (timeStr, minutes) => {
  const [h, m] = timeStr.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toTimeString().split(" ")[0];
};

/* ── Shared notify helper ── */
const notifyResident = async (userId, title, msg, societyId) => {
  const notification = await Notification.create({
    title, message: msg,
    type: "AMENITY", action_type: "VIEW_AMENITY", action_route: "/resident/amenities",
    society_id: societyId, receiver_user_id: userId,
  });
  if (global.io) global.io.to(`user_${userId}`).emit("new_notification", notification);

  const user = await User.findByPk(userId, { attributes: ["fcm_token"] });
  if (user?.fcm_token) {
    sendPushNotification(user.fcm_token, title, msg, { route: "/resident/amenities" }).catch(console.error);
  }
};

/* ── Date range label for notifications ── */
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
const bookingLabel = (b) => slotLabel(b) || dateRangeLabel(b);

/* ═══════════════════════════════════════
   CREATE AMENITY
═══════════════════════════════════════ */
exports.createAmenity = async (req, res) => {
  try {
    const amenity = await Amenity.create({
      ...req.body,
      society_id: req.user.society_id,
    });
    res.status(201).json({ success: true, data: amenity });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   UPDATE AMENITY
═══════════════════════════════════════ */
exports.updateAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const amenity = await Amenity.findOne({ where: { id, society_id: req.user.society_id } });
    if (!amenity) return res.status(404).json({ success: false, message: "Amenity not found" });
    await amenity.update(req.body);
    res.json({ success: true, data: amenity });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   TOGGLE (re-enable)
═══════════════════════════════════════ */
exports.toggleAmenity = async (req, res) => {
  try {
    const amenity = await Amenity.findOne({
      where: { id: req.params.id, society_id: req.user.society_id },
    });
    if (!amenity) return res.status(404).json({ success: false, message: "Amenity not found" });

    amenity.is_active = !amenity.is_active;
    if (amenity.is_active) {
      amenity.disable_type    = null;
      amenity.disabled_reason = null;
      amenity.disabled_from   = null;
      amenity.disabled_until  = null;
    }
    await amenity.save();

    res.json({
      success: true,
      status:  amenity.is_active ? "ACTIVE" : "INACTIVE",
      message: `Amenity is now ${amenity.is_active ? "Active" : "Inactive"}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   DISABLE AMENITY
═══════════════════════════════════════ */
exports.disableAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const { disableType, reason, fromDate, untilDate, notifyResidents } = req.body;

    if (!["TEMPORARY", "PERMANENT"].includes(disableType))
      return res.status(400).json({ success: false, message: "Invalid disableType." });
    if (!reason?.trim())
      return res.status(400).json({ success: false, message: "A reason is required." });
    if (disableType === "TEMPORARY" && !untilDate)
      return res.status(400).json({ success: false, message: "untilDate is required for TEMPORARY closure." });

    const amenity = await Amenity.findOne({ where: { id, society_id: req.user.society_id } });
    if (!amenity) return res.status(404).json({ success: false, message: "Amenity not found" });

    await amenity.update({
      is_active:       false,
      disable_type:    disableType,
      disabled_reason: reason.trim(),
      disabled_from:   fromDate  || null,
      disabled_until:  disableType === "TEMPORARY" ? untilDate : null,
    });

    /* Auto-cancel all PAYMENT_PENDING bookings for this amenity */
    const pendingPayments = await AmenityBooking.findAll({
      where: { amenity_id: id, status: "PAYMENT_PENDING" },
    });
    for (const b of pendingPayments) {
      await b.update({ status: "CANCELLED", payment_status: "FAILED", payment_expires_at: null });
    }

    if (notifyResidents) {
      const closureLabel = disableType === "TEMPORARY"
        ? `temporarily closed until ${untilDate}`
        : "permanently closed";
      const notifTitle = `${amenity.name} — Closed`;
      const notifMsg   = `⚠️ ${amenity.name} is ${closureLabel}. Reason: ${reason.trim()}`;

      const residents = await User.findAll({
        where: { society_id: req.user.society_id, role: "RESIDENT" },
        attributes: ["id", "fcm_token"],
      });

      await Promise.all(residents.map(async (resident) => {
        const notification = await Notification.create({
          title: notifTitle, message: notifMsg,
          type: "AMENITY", action_type: "VIEW_AMENITY", action_route: "/resident/amenities",
          society_id: req.user.society_id, receiver_user_id: resident.id,
        });
        if (global.io) global.io.to(`user_${resident.id}`).emit("new_notification", notification);
        if (resident.fcm_token) {
          sendPushNotification(resident.fcm_token, notifTitle, notifMsg, { route: "/resident/amenities" })
            .catch(console.error);
        }
      }));
    }

    res.json({ success: true, message: `Amenity disabled (${disableType})`, data: amenity });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   GET ALL BOOKINGS
   Includes PAYMENT_PENDING so admin can see "awaiting payment" state.
═══════════════════════════════════════ */
exports.getAllBookings = async (req, res) => {
  try {
    const { date, amenityId, status } = req.query;
    const where = { society_id: req.user.society_id };

    /* Range-aware date filter: match bookings whose [from_date, to_date] overlaps the queried date */
    if (date) {
      where[Op.and] = [
        { from_date: { [Op.lte]: date } },
        { to_date:   { [Op.gte]: date } },
      ];
    }
    if (amenityId) where.amenity_id = amenityId;
    if (status)    where.status     = status;

    const bookings = await AmenityBooking.findAll({
      where,
      include: [
        { model: Amenity, attributes: ["name", "type"] },
        { model: User,    attributes: ["name", "email", "phone"] },
        { model: Flat,    attributes: ["flat_number"] },
      ],
      order: [["from_date", "DESC"], ["start_time", "ASC"]],
    });

    /* Annotate PAYMENT_PENDING rows with remaining expiry time (seconds) */
    const now = new Date();
    const enriched = bookings.map((b) => {
      const plain = b.toJSON();
      if (b.status === "PAYMENT_PENDING" && b.payment_expires_at) {
        const remaining = Math.max(0, Math.round((new Date(b.payment_expires_at) - now) / 1000));
        plain.payment_expires_in_seconds = remaining;
      }
      return plain;
    });

    // Single-row bookings: pass through with computed date_count/slot_count
    // Legacy multi-row: groupAmenityBookings merges as before
    const data = groupAmenityBookings(enriched);

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   GET PENDING BOOKINGS (approval queue)
   Only shows PENDING (payment confirmed, needs admin approval).
   PAYMENT_PENDING bookings are NOT in the approval queue.
═══════════════════════════════════════ */
exports.getPendingBookings = async (req, res) => {
  try {
    const bookings = await AmenityBooking.findAll({
      where: { society_id: req.user.society_id, status: "PENDING" },
      include: [
        { model: Amenity, attributes: ["name"] },
        { model: User,    attributes: ["name", "phone"] },
        { model: Flat,    attributes: ["flat_number"] },
      ],
      order: [["from_date", "ASC"]],
    });
    res.json({ success: true, data: groupAmenityBookings(bookings) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   APPROVE BOOKING
   Only valid for status = PENDING (payment already confirmed).
═══════════════════════════════════════ */
exports.approveBooking = async (req, res) => {
  try {
    const ids = (req.body && Array.isArray(req.body.booking_ids) && req.body.booking_ids.length)
      ? req.body.booking_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [Number(req.params.id)];

    const bookings = await AmenityBooking.findAll({
      where: { id: { [Op.in]: ids }, society_id: req.user.society_id },
      include: [
        { model: User,    attributes: ["id", "fcm_token"] },
        { model: Amenity, attributes: ["name"] },
      ],
    });
    if (bookings.length === 0) return res.status(404).json({ message: "Booking not found" });

    const invalid = bookings.filter((b) => b.status !== "PENDING");
    if (invalid.length > 0)
      return res.status(400).json({ message: `Cannot approve a booking in '${invalid[0].status}' status.` });

    await Promise.all(bookings.map((b) => b.update({ status: "APPROVED" })));

    const first = bookings[0];
    await notifyResident(
      first.user_id,
      "Booking Approved ✅",
      `✅ Your booking for ${first.Amenity.name} on ${bookingLabel(first)} has been approved.`,
      req.user.society_id
    );

    res.json({ success: true, message: "Booking approved." });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   REJECT BOOKING
═══════════════════════════════════════ */
exports.rejectBooking = async (req, res) => {
  try {
    const ids = (req.body && Array.isArray(req.body.booking_ids) && req.body.booking_ids.length)
      ? req.body.booking_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [Number(req.params.id)];

    const bookings = await AmenityBooking.findAll({
      where: { id: { [Op.in]: ids }, society_id: req.user.society_id },
      include: [
        { model: User,    attributes: ["id", "fcm_token"] },
        { model: Amenity, attributes: ["name"] },
      ],
    });
    if (bookings.length === 0) return res.status(404).json({ message: "Booking not found" });

    const invalid = bookings.filter((b) => b.status !== "PENDING");
    if (invalid.length > 0)
      return res.status(400).json({ message: `Cannot reject a booking in '${invalid[0].status}' status.` });

    await Promise.all(bookings.map((b) => b.update({ status: "REJECTED" })));

    const first = bookings[0];
    await notifyResident(
      first.user_id,
      "Booking Rejected",
      `❌ Your booking for ${first.Amenity.name} on ${bookingLabel(first)} has been rejected.`,
      req.user.society_id
    );

    res.json({ success: true, message: "Booking rejected." });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   CANCEL BOOKING (admin force)
═══════════════════════════════════════ */
exports.cancelBooking = async (req, res) => {
  try {
    const ids = (req.body && Array.isArray(req.body.booking_ids) && req.body.booking_ids.length)
      ? req.body.booking_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [Number(req.params.id)];

    const bookings = await AmenityBooking.findAll({
      where: { id: { [Op.in]: ids }, society_id: req.user.society_id },
      include: [
        { model: User,    attributes: ["id", "fcm_token"] },
        { model: Amenity, attributes: ["name"] },
      ],
    });
    if (bookings.length === 0) return res.status(404).json({ message: "Booking not found" });

    await Promise.all(bookings.map((b) => b.update({ status: "CANCELLED", payment_expires_at: null })));

    const first = bookings[0];
    await notifyResident(
      first.user_id,
      "Booking Cancelled",
      `⚠️ Your booking for ${first.Amenity.name} on ${bookingLabel(first)} has been cancelled by the admin.`,
      req.user.society_id
    );

    res.json({ success: true, message: "Booking cancelled by admin." });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ═══════════════════════════════════════
   ADMIN AVAILABILITY
═══════════════════════════════════════ */
exports.getAdminAvailability = async (req, res) => {
  try {
    const { id }   = req.params;
    const { date } = req.query;

    const amenity = await Amenity.findOne({ where: { id, society_id: req.user.society_id } });
    if (!amenity) return res.status(404).json({ message: "Amenity not found" });

    /* Fetch all active bookings whose range overlaps the queried date */
    const dayBookings = await AmenityBooking.findAll({
      where: {
        amenity_id: id,
        status: { [Op.notIn]: ["CANCELLED", "REJECTED"] },
        [Op.or]: [
          { from_date: { [Op.lte]: date }, to_date: { [Op.gte]: date } },
          { from_date: null, date },
        ],
      },
    });

    const slots = [];
    let currentTime = amenity.opening_time;
    const duration  = amenity.slot_duration;

    while (addMinutes(currentTime, duration) <= amenity.closing_time) {
      const endTime = addMinutes(currentTime, duration);
      let count = 0;

      for (const b of dayBookings) {
        if (Array.isArray(b.slots) && b.slots.length) {
          /* New single-row: check if any slot in the JSON matches this time window */
          if (b.slots.some((s) => s.date === date && s.start_time < endTime && s.end_time > currentTime)) {
            count++;
          }
        } else if (b.date === date && b.start_time < endTime && b.end_time > currentTime) {
          count++;
        }
      }

      slots.push({
        start_time:  currentTime,
        end_time:    endTime,
        booked:      count,
        capacity:    amenity.capacity,
        utilization: Math.round((count / amenity.capacity) * 100) + "%",
      });

      currentTime = endTime;
    }

    res.json({ success: true, data: slots });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};