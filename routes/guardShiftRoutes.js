const express = require("express");
const router  = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  upsertShift,
  updateShift,
  deleteShift,
  getMyShift,
  getSocietyShifts,
  getGuardShiftByGuard,
} = require("../controllers/guardShiftControllers");


// Admin creates a new shift (with overlap validation)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), upsertShift);

// Guard sees his own active shift
router.get("/my", auth, role("GUARD"), getMyShift);

// Admin views all shifts
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getSocietyShifts);

// Admin views shifts for a specific guard
router.get("/:guardId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getGuardShiftByGuard);

// Admin updates an existing shift by ID (with overlap validation)
router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateShift);

// Admin deletes a shift by ID
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteShift);

module.exports = router;
