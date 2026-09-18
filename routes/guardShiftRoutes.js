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


// Admin / Committee creates a new shift (with overlap validation)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), upsertShift);

// Guard sees his own active shift
router.get("/my", auth, role("GUARD"), getMyShift);

// Admin / Committee views all shifts
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getSocietyShifts);

// Admin / Committee views shifts for a specific guard
router.get("/:guardId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getGuardShiftByGuard);

// Admin / Committee updates an existing shift by ID (with overlap validation)
router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), updateShift);

// Admin / Committee deletes a shift by ID
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), deleteShift);

module.exports = router;
