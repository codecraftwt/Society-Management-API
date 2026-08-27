const GuardShift = require("../models/GuardShift");
const { Op } = require("sequelize");

/* ── IST date helper ── */
const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/* ── CURRENT SHIFT HELPER (IST) — used only for guard's own "am I on duty now?" check ── */
const getCurrentShiftType = () => {
  const hour = parseInt(
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10
  );
  if (hour >= 8 && hour < 16)  return "MORNING";
  if (hour >= 16 && hour < 24) return "AFTERNOON";
  return "NIGHT";
};

/* ── Date overlap check: true if [aStart..aEnd] overlaps [bStart..bEnd] ── */
const datesOverlap = (aStart, aEnd, bStart, bEnd) =>
  aStart <= bEnd && aEnd >= bStart;

/* === UPSERT SHIFT (create or update — overlap validation) === */
const upsertShift = async (req, res) => {
  try {
    const { guard_id, shift_type, start_date, end_date } = req.body;
    const society_id = req.user.society_id;

    if (!guard_id || !shift_type || !start_date || !end_date) {
      return res.status(400).json({ message: "guard_id, shift_type, start_date, and end_date are required" });
    }

    if (start_date > end_date) {
      return res.status(400).json({ message: "start_date must be on or before end_date" });
    }

    /* Find ALL existing shifts of the same type for this guard in this society */
    const existingShifts = await GuardShift.findAll({
      where: { guard_id, society_id, shift_type },
    });

    /* Check each for date overlap */
    const overlapping = existingShifts.find(s =>
      datesOverlap(s.start_date, s.end_date, start_date, end_date)
    );

    if (overlapping) {
      return res.status(409).json({
        message: `A ${shift_type} shift already exists from ${overlapping.start_date} to ${overlapping.end_date}. Update it instead.`,
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

    /* Check overlap with OTHER shifts of same type for same guard+ society */
    const otherShifts = await GuardShift.findAll({
      where: {
        guard_id:   shift.guard_id,
        society_id: shift.society_id,
        shift_type: newType,
        id: { [Op.ne]: shift.id },
      },
    });

    const overlapping = otherShifts.find(s =>
      datesOverlap(s.start_date, s.end_date, newStart, newEnd)
    );

    if (overlapping) {
      return res.status(409).json({
        message: `A ${newType} shift already exists from ${overlapping.start_date} to ${overlapping.end_date}. Update it instead.`,
        existingShift: overlapping,
      });
    }

    await shift.update({ shift_type: newType, start_date: newStart, end_date: newEnd });
    res.json(shift);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === GET MY SHIFT (guard's own active shift with isOnDuty status) === */
const getMyShift = async (req, res) => {
  try {
    const today = getTodayIST();
    const currentShiftType = getCurrentShiftType();

    /* First: try to find the currently active shift type */
    let shift = await GuardShift.findOne({
      where: {
        guard_id:   req.user.id,
        society_id: req.user.society_id,
        shift_type: currentShiftType,
        start_date: { [Op.lte]: today },
        end_date:   { [Op.gte]: today },
      },
    });

    if (shift) {
      return res.json({
        ...shift.toJSON(),
        isOnDuty: true,
      });
    }

    /* Fallback: find ANY shift covering today (different type) */
    shift = await GuardShift.findOne({
      where: {
        guard_id:   req.user.id,
        society_id: req.user.society_id,
        start_date: { [Op.lte]: today },
        end_date:   { [Op.gte]: today },
      },
      order: [["updatedAt", "DESC"]],
    });

    if (shift) {
      return res.json({
        ...shift.toJSON(),
        isOnDuty: false,
      });
    }

    res.json(null);
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
    const shifts = await GuardShift.findAll({
      where: {
        guard_id:   req.params.guardId,
        society_id: req.user.society_id,
      },
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


module.exports = {
  upsertShift,
  updateShift,
  deleteShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
};
