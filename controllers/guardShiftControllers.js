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
  if (hour >= 8 && hour < 16)  return "MORNING";    // 8–16
  if (hour >= 16 && hour < 24) return "AFTERNOON";  // 16–24
  return "NIGHT";                                   // 0–8
};

/* === CREATE SHIFT === */
const createShift = async (req, res) => {
  try {
    const shift = await GuardShift.create({
      guard_id:   req.body.guard_id,
      society_id: req.user.society_id,
      shift_type: req.body.shift_type,
      start_date: req.body.start_date,
      end_date:   req.body.end_date,
    });
    res.json(shift);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === UPSERT SHIFT (create or update — one row per guard) === */
const upsertShift = async (req, res) => {
  try {
    const { guard_id, shift_type, start_date, end_date } = req.body;

    let shift = await GuardShift.findOne({
      where: {
        guard_id,
        society_id: req.user.society_id,
      },
    });

    if (shift) {
      await shift.update({ shift_type, start_date, end_date });
    } else {
      shift = await GuardShift.create({
        guard_id,
        society_id: req.user.society_id,
        shift_type,
        start_date,
        end_date,
      });
    }

    res.json(shift);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === GET MY SHIFT (guard's own active shift for the CURRENT shift window) ===
   This is the only place where shift_type filtering makes sense:
   a guard checking "am I on duty right now?" should only see a shift
   that matches the current time window AND is within the date range.        */
const getMyShift = async (req, res) => {
  try {
    const today = getTodayIST();

    const shift = await GuardShift.findOne({
      where: {
        guard_id: req.user.id,
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today },
      },
      order: [["updatedAt", "DESC"]], // optional but good
    });

    res.json(shift || null);
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

/* === GET SHIFT BY GUARD ID (admin — any assigned shift, not time-restricted) ===
   ✅ FIX: Removed shift_type: currentShift filter.
   The admin needs to see whatever shift is assigned to this guard regardless
   of whether it matches the current time of day. Filtering by current shift
   was causing the Edit button to silently return null and the modal to appear
   blank, making updates impossible outside the assigned shift window.        */
const getGuardShiftByGuard = async (req, res) => {
  try {
    const shift = await GuardShift.findOne({
      where: {
        guard_id:   req.params.guardId,
        society_id: req.user.society_id,
        // ✅ No shift_type filter — admin can view/edit any shift at any time
        // ✅ No date filter either — show the assigned shift even if it's future/past
      },
      order: [["updatedAt", "DESC"]], // most recently updated row wins
    });

    res.json(shift || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* === UPDATE SHIFT BY ID === */
const updateShift = async (req, res) => {
  try {
    const shift = await GuardShift.findByPk(req.params.id);

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    await shift.update(req.body);
    res.json(shift);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createShift,
  upsertShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
  updateShift,
};