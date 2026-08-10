const express = require("express");
const router  = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  upsertShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
} = require("../controllers/guardShiftControllers");

// Admin creates or updates a guard's shift (upsert — one row per guard)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), upsertShift);

// Guard sees his own active shift
router.get("/my", auth, role("GUARD"), getMyShift);

// Admin views all shifts
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getSocietyShifts);

// Admin views active shift for a specific guard
router.get("/:guardId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getGuardShiftByGuard);

// Admin updates an existing shift (also upsert — same logic)
router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), upsertShift);

module.exports = router;