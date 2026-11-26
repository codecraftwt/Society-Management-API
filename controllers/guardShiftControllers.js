const GuardShift = require("../models/GuardShift");
const GuardShiftTiming = require("../models/GuardShiftTiming");
const GuardShiftPlace = require("../models/GuardShiftPlace");
const User = require("../models/User");
const { Op } = require("sequelize");
const {
  getCurrentISTDate,
  getCurrentISTDateTime,
} = require("../utils/istTime");
const {
  SHIFT_TYPES,
  getShiftTimings,
  validateTimingsConfig,
} = require("../utils/shiftTiming");
const {
  addDays,
  getShiftOccurrenceAt,
} = require("../utils/guardShiftOccurrence");

/* ── Date overlap check: true if [aStart..aEnd] overlaps [bStart..bEnd] ── */
const datesOverlap = (aStart, aEnd, bStart, bEnd) =>
  aStart <= bEnd && aEnd >= bStart;

const SHIFT_PLACE_INCLUDE = {
  model: GuardShiftPlace,
  as: "shiftPlace",
  attributes: ["id", "name", "description", "is_active"],
};

const resolveShiftPlaceId = async (rawPlaceId, societyId) => {
  if (rawPlaceId === undefined) return undefined;
  if (rawPlaceId === null || rawPlaceId === "") return null;
  const placeId = parseInt(rawPlaceId, 10);
  if (!Number.isInteger(placeId) || placeId <= 0) {
    const err = new Error("Invalid shift place selected.");
    err.statusCode = 400;
    throw err;
  }
  const where = { id: placeId };
  if (societyId) where.society_id = societyId;
  const place = await GuardShiftPlace.findOne({ where });
  if (!place) {
    const err = new Error("Selected shift place not found for this society.");
    err.statusCode = 400;
    throw err;
  }
  return place.id;
};

/* === UPSERT SHIFT (create or update — overlap validation) === */
const upsertShift = async (req, res) => {
  try {
    const { guard_id, shift_type, shift_place_id, start_date, end_date } = req.body;
    let society_id = req.user.society_id;

    /* SUPER_ADMIN isn't scoped to a society — resolve the guard's own society */
    if (!society_id) {
      const guard = await User.findByPk(guard_id);
      society_id = guard?.society_id ?? null;
    }

    if (!guard_id || !shift_type || !start_date || !end_date) {
      return res.status(400).json({ message: "guard_id, shift_type, start_date, and end_date are required" });
    }

    if (start_date > end_date) {
      return res.status(400).json({ message: "start_date must be on or before end_date" });
    }

    /* Find ALL existing shifts for this guard in this society (any type —
       a guard can only hold ONE shift covering any given date) */
    const existingShifts = await GuardShift.findAll({
      where: { guard_id, society_id },
    });

    /* Check each for date overlap */
    const overlapping = existingShifts.find(s =>
      datesOverlap(s.start_date, s.end_date, start_date, end_date)
    );

    if (overlapping) {
      return res.status(409).json({
        message: `A ${overlapping.shift_type} shift already exists from ${overlapping.start_date} to ${overlapping.end_date}. Edit that shift instead of creating a new one.`,
        existingShift: overlapping,
      });
    }

    const resolvedPlaceId = await resolveShiftPlaceId(shift_place_id, society_id);

    /* No overlap — create new record */
    const shift = await GuardShift.create({
      guard_id,
      society_id,
      shift_type,
      shift_place_id: resolvedPlaceId ?? null,
      start_date,
      end_date,
    });

    const created = await GuardShift.findByPk(shift.id, {
      include: [SHIFT_PLACE_INCLUDE],
    });

    res.json(created || shift);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        message: "A shift with this shift type already exists for this guard. Update the existing shift instead.",
      });
    }
    res.status(500).json({ message: err.message });
  }
};

/* === UPDATE SHIFT BY ID (direct update — also checks overlap excluding self) === */
const updateShift = async (req, res) => {
  try {
    const shift = await GuardShift.findByPk(req.params.id);

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    const { shift_type, shift_place_id, start_date, end_date } = req.body;
    const newType  = shift_type || shift.shift_type;
    const newStart = start_date || shift.start_date;
    const newEnd   = end_date   || shift.end_date;
    const resolvedPlaceId = await resolveShiftPlaceId(shift_place_id, shift.society_id);
    const newPlaceId = resolvedPlaceId !== undefined ? resolvedPlaceId : shift.shift_place_id;

    if (newStart > newEnd) {
      return res.status(400).json({ message: "start_date must be on or before end_date" });
    }

    /* Check overlap with OTHER shifts of the same guard+society (any type) */
    const otherShifts = await GuardShift.findAll({
      where: {
        guard_id:   shift.guard_id,
        society_id: shift.society_id,
        id: { [Op.ne]: shift.id },
      },
    });

    const overlapping = otherShifts.find(s =>
      datesOverlap(s.start_date, s.end_date, newStart, newEnd)
    );

    if (overlapping) {
      return res.status(409).json({
        message: `A ${overlapping.shift_type} shift already exists from ${overlapping.start_date} to ${overlapping.end_date}. Edit that shift instead of creating a new one.`,
        existingShift: overlapping,
      });
    }

    await shift.update({
      shift_type: newType,
      shift_place_id: newPlaceId,
      start_date: newStart,
      end_date: newEnd,
    });
    const updated = await GuardShift.findByPk(shift.id, {
      include: [SHIFT_PLACE_INCLUDE],
    });
    res.json(updated || shift);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        message: "A shift with this shift type already exists for this guard. Update the existing shift instead.",
      });
    }
    res.status(500).json({ message: err.message });
  }
};

/* === GET MY SHIFT (guard's own active shift with isOnDuty status) === */
const getMyShift = async (req, res) => {
  try {
    const today = getCurrentISTDate();
    const guardId = req.user.id;
    let societyId = req.user.society_id;

    if (!societyId) {
      const guard = await User.findByPk(guardId, { attributes: ["society_id"] });
      societyId = guard?.society_id ?? null;
    }

    /* Find ANY shift covering today — duty is decided by the configured
       window for that shift's type, not by matching a hardcoded window. */
    const where = {
      guard_id: guardId,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    };
    if (societyId) {
      where.society_id = societyId;
    }

    const shifts = await GuardShift.findAll({
      where,
      include: [SHIFT_PLACE_INCLUDE],
      order: [["updatedAt", "DESC"]],
    });

    if (!shifts.length) {
      return res.json(null);
    }

    const timings = societyId ? await getShiftTimings(societyId) : {};
    const now = new Date();
    const activeOccurrences = shifts
      .map((shift) => ({ shift, occurrence: getShiftOccurrenceAt(shift, timings, now) }))
      .filter((entry) => entry.occurrence);

    if (activeOccurrences.length > 1) {
      return res.status(409).json({
        message: "More than one shift occurrence is active. Please contact admin to fix overlapping shifts.",
        code: "MULTIPLE_ACTIVE_SHIFTS",
      });
    }

    const selected =
      activeOccurrences[0] ||
      shifts
        .filter((shift) => String(shift.start_date) <= today && String(shift.end_date) >= today)
        .map((shift) => ({ shift, occurrence: null }))[0] ||
      null;

    if (!selected) {
      return res.json(null);
    }

    const { shift, occurrence } = selected;
    const t = timings[shift.shift_type] || {};
    const startTime = occurrence?.start_time || t.start || "00:00";
    const endTime = occurrence?.end_time || t.end || "00:00";
    const attendanceDate = occurrence?.occurrence_date || today;

    const { GuardAttendance } = require("../models");
    const attendanceWhere = {
      guard_id: guardId,
      shift_id: shift.id,
      attendance_date: attendanceDate,
    };
    if (societyId) {
      attendanceWhere.society_id = societyId;
    }

    const attendance = await GuardAttendance.findOne({
      where: attendanceWhere,
    });

    return res.json({
      ...shift.toJSON(),
      isOnDuty: Boolean(occurrence),
      start_time: startTime,
      end_time: endTime,
      window: `${startTime} - ${endTime}`,
      occurrence_date: attendanceDate,
      occurrence_start_at: occurrence?.start || null,
      occurrence_end_at: occurrence?.end || null,
      attendance: attendance ? attendance.toJSON() : null,
      server_now: getCurrentISTDateTime(),
      timezone: "Asia/Kolkata",
    });
  } catch (err) {
    console.error("[getMyShift] error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* === GET ALL SHIFTS (society) === */
const getSocietyShifts = async (req, res) => {
  try {
    const shifts = await GuardShift.findAll({
      where: { society_id: req.user.society_id },
      include: [SHIFT_PLACE_INCLUDE],
      order: [["start_date", "DESC"]],
    });
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === GET SHIFTS BY GUARD ID (admin — all shifts for a guard) === */
const getGuardShiftByGuard = async (req, res) => {
  try {
    const where = { guard_id: req.params.guardId };

    /* Super Admin isn't scoped to any society — show every shift for the guard */
    if (req.user.role !== "SUPER_ADMIN") {
      where.society_id = req.user.society_id;
    }

    const shifts = await GuardShift.findAll({
      where,
      include: [SHIFT_PLACE_INCLUDE],
      order: [["shift_type", "ASC"]],
    });

    res.json(shifts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === DELETE SHIFT BY ID === */
const deleteShift = async (req, res) => {
  try {
    const shift = await GuardShift.findByPk(req.params.id);

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    await shift.destroy();
    res.json({ message: "Shift deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────
   SOCIETY SHIFT-TIMING CONFIG  (assignment ≠ timing)
   ───────────────────────────────────────────── */
const resolveSocietyId = (req) => {
  /* Non-super-admins are always scoped to their own society and must NOT
     pick another via query/body param. */
  if (String(req.user.role) !== "SUPER_ADMIN") {
    return req.user.society_id;
  }
  const raw = req.query.society_id || req.body?.society_id;
  const id = raw != null ? parseInt(raw, 10) : null;
  if (!id) {
    throw new Error("Super Admin must provide a society_id.");
  }
  return id;
};

/* === GET SOCIETY SHIFT TIMINGS === */
const getShiftTimingsCtrl = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    const timings = await getShiftTimings(societyId);
    res.json({
      society_id: societyId,
      timings,
      server_now: getCurrentISTDateTime(),
      timezone: "Asia/Kolkata",
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/* === PUT SOCIETY SHIFT TIMINGS (upsert all three types) === */
const upsertShiftTimings = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    const valid = validateTimingsConfig(req.body?.timings || req.body);

    for (const type of SHIFT_TYPES) {
      const e = valid[type];
      const [row] = await GuardShiftTiming.findOrCreate({
        where: { society_id: societyId, shift_type: type },
        defaults: { start_time: e.start, end_time: e.end },
      });
      await row.update({ start_time: e.start, end_time: e.end });
    }

    const timings = await getShiftTimings(societyId);
    res.json({
      society_id: societyId,
      timings,
      message: "Shift timings updated.",
      server_now: getCurrentISTDateTime(),
      timezone: "Asia/Kolkata",
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};


/* ─────────────────────────────────────────────
   SHIFT PLACES (customizable guard duty posts / gates)
   ───────────────────────────────────────────── */
const listShiftPlaces = async (req, res) => {
  try {
    const where = {};
    if (String(req.user.role) !== "SUPER_ADMIN") {
      where.society_id = req.user.society_id;
    } else if (req.query.society_id && req.query.society_id !== "ALL") {
      where.society_id = parseInt(req.query.society_id, 10);
    }

    if (req.query.activeOnly === "true") {
      where.is_active = true;
    }

    const places = await GuardShiftPlace.findAll({
      where,
      order: [["name", "ASC"]],
    });

    res.json({ success: true, places });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createShiftPlace = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Shift place name is required." });
    }
    if (name.length > 100) {
      return res.status(400).json({ message: "Shift place name must be 100 characters or less." });
    }

    const description = req.body?.description != null ? String(req.body.description).trim() || null : null;

    const existing = await GuardShiftPlace.findOne({
      where: { society_id: societyId, name },
    });
    if (existing) {
      return res.status(409).json({ message: "A shift place with this name already exists." });
    }

    const place = await GuardShiftPlace.create({
      society_id: societyId,
      name,
      description,
      is_active: req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true,
    });

    res.status(201).json({ success: true, place, message: "Shift place created." });
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "A shift place with this name already exists." });
    }
    res.status(400).json({ message: err.message });
  }
};

const updateShiftPlace = async (req, res) => {
  try {
    const place = await GuardShiftPlace.findByPk(req.params.id);
    if (!place) {
      return res.status(404).json({ message: "Shift place not found." });
    }

    if (String(req.user.role) !== "SUPER_ADMIN" && place.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Not authorized to update this shift place." });
    }

    const updates = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) {
        return res.status(400).json({ message: "Shift place name cannot be empty." });
      }
      if (name.length > 100) {
        return res.status(400).json({ message: "Shift place name must be 100 characters or less." });
      }
      const dup = await GuardShiftPlace.findOne({
        where: {
          society_id: place.society_id,
          name,
          id: { [Op.ne]: place.id },
        },
      });
      if (dup) {
        return res.status(409).json({ message: "A shift place with this name already exists." });
      }
      updates.name = name;
    }

    if (req.body?.description !== undefined) {
      updates.description = req.body.description != null ? String(req.body.description).trim() || null : null;
    }

    if (req.body?.is_active !== undefined) {
      updates.is_active = Boolean(req.body.is_active);
    }

    await place.update(updates);
    res.json({ success: true, place, message: "Shift place updated." });
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "A shift place with this name already exists." });
    }
    res.status(400).json({ message: err.message });
  }
};

const deleteShiftPlace = async (req, res) => {
  try {
    const place = await GuardShiftPlace.findByPk(req.params.id);
    if (!place) {
      return res.status(404).json({ message: "Shift place not found." });
    }

    if (String(req.user.role) !== "SUPER_ADMIN" && place.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Not authorized to delete this shift place." });
    }

    await place.destroy();
    res.json({ success: true, message: "Shift place deleted." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  upsertShift,
  updateShift,
  deleteShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
  getShiftTimingsCtrl,
  upsertShiftTimings,
  listShiftPlaces,
  createShiftPlace,
  updateShiftPlace,
  deleteShiftPlace,
};
