const GuardShift = require("../models/GuardShift");
const GuardShiftTiming = require("../models/GuardShiftTiming");
const User = require("../models/User");
const { Op } = require("sequelize");
const {
  getCurrentISTDate,
  getCurrentISTMinutes,
  getCurrentISTDateTime,
} = require("../utils/istTime");
const {
  SHIFT_TYPES,
  getShiftTimings,
  getCurrentShiftTypeFromTimings,
  isTimeInShift,
  validateTimingsConfig,
} = require("../utils/shiftTiming");

/* ── Date overlap check: true if [aStart..aEnd] overlaps [bStart..bEnd] ── */
const datesOverlap = (aStart, aEnd, bStart, bEnd) =>
  aStart <= bEnd && aEnd >= bStart;

/* === UPSERT SHIFT (create or update — overlap validation) === */
const upsertShift = async (req, res) => {
  try {
    const { guard_id, shift_type, start_date, end_date } = req.body;
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

    /* No overlap — create new record */
    const shift = await GuardShift.create({
      guard_id,
      society_id,
      shift_type,
      start_date,
      end_date,
    });

    res.json(shift);
  } catch (err) {
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

    const { shift_type, start_date, end_date } = req.body;
    const newType  = shift_type || shift.shift_type;
    const newStart = start_date || shift.start_date;
    const newEnd   = end_date   || shift.end_date;

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

    await shift.update({ shift_type: newType, start_date: newStart, end_date: newEnd });
    res.json(shift);
  } catch (err) {
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

    /* Find ANY shift covering today — duty is decided by the configured
       window for that shift's type, not by matching a hardcoded window. */
    const shifts = await GuardShift.findAll({
      where: {
        guard_id:   req.user.id,
        society_id: req.user.society_id,
        start_date: { [Op.lte]: today },
        end_date:   { [Op.gte]: today },
      },
      order: [["updatedAt", "DESC"]],
    });

    if (!shifts.length) {
      return res.json(null);
    }

    const timings = await getShiftTimings(req.user.society_id);
    const minutes = getCurrentISTMinutes();

    let shift = shifts[0];
    for (const s of shifts) {
      if (s.shift_type && isTimeInShift(timings, s.shift_type, minutes)) {
        shift = s;
        break;
      }
    }

    const t = timings[shift.shift_type] || {};
    const startTime = t.start || "00:00";
    const endTime = t.end || "00:00";

    return res.json({
      ...shift.toJSON(),
      isOnDuty: isTimeInShift(timings, shift.shift_type, minutes),
      start_time: startTime,
      end_time: endTime,
      window: `${startTime} - ${endTime}`,
      server_now: getCurrentISTDateTime(),
      timezone: "Asia/Kolkata",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === GET ALL SHIFTS (society) === */
const getSocietyShifts = async (req, res) => {
  try {
    const shifts = await GuardShift.findAll({
      where: { society_id: req.user.society_id },
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


module.exports = {
  upsertShift,
  updateShift,
  deleteShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
  getShiftTimingsCtrl,
  upsertShiftTimings,
};
