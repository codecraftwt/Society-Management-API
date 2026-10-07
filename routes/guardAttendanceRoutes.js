const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const uploadGuardSelfie = require("../middlewares/uploadGuardSelfie");

const {
  punchIn,
  punchOut,
  getTodayAttendance,
  listAttendance,
  getTodaySummary,
  manualCorrection,
} = require("../controllers/guardAttendanceControllers");

/* ── Guard self-service ── */

// Punch-in (multipart/form-data: selfie + lat + lng)
router.post(
  "/punch-in",
  auth,
  role("GUARD"),
  uploadGuardSelfie.single("selfie"),
  punchIn
);

// Punch-out (lat + lng + accuracy, NO photo required)
router.post(
  "/punch-out",
  auth,
  role("GUARD"),
  punchOut
);

// Guard views own today's record
router.get("/today", auth, role("GUARD"), getTodayAttendance);

/* ── Admin / Committee views ── */

// Today's full summary (count + list)
router.get(
  "/summary/today",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  getTodaySummary
);

// Full paginated list with filters: ?date=YYYY-MM-DD&guard_id=X&status=PUNCHED_IN&page=1&limit=50
router.get(
  "/",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  listAttendance
);

// Manual correction by admin
router.put(
  "/:id/correct",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN"),
  manualCorrection
);

module.exports = router;
