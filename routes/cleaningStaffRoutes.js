const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
const upload = require("../middlewares/uploadProfilePicture");
const handleProfilePictureUploadErrors = require("../middlewares/profilePictureUploadErrors");

const {
  getCleaningStaff,
  getCleaningStaffById,
  createCleaningStaff,
  updateCleaningStaff,
  updateCleaningStaffStatus,
  deleteCleaningStaffNotAllowed,

  createCleaningStaffPass,
  getCleaningStaffPasses,
  revokeCleaningStaffPass,

  scanCleaningStaffPass,

  getCleaningStaffAttendance,
  getStaffAttendance,
  updateCleaningStaffAttendance,

  handle,
} = require("../controllers/cleaningStaffControllers");

const ADMIN_ROLES = ["SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"];

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE ORDER MATTERS
   Express matches in declaration order, so every literal segment below must be
   declared BEFORE the "/:id" patterns, otherwise "/scan" would be read as
   id === "scan" and hit the 404 branch.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── GATE SCAN (guard, on duty) ──────────────────────────────────────────── */
router.post(
  "/scan",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD"),
  handle(scanCleaningStaffPass)
);

/* ── ATTENDANCE (literal paths, must precede /:id) ───────────────────────── */
router.get(
  "/attendance",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "view"),
  handle(getCleaningStaffAttendance)
);

router.patch(
  "/attendance/:attendanceId",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "edit_attendance"),
  handle(updateCleaningStaffAttendance)
);

/* ── PASS REVOCATION (literal prefix, must precede /:id) ─────────────────── */
router.patch(
  "/passes/:passId/revoke",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "edit_passes"),
  handle(revokeCleaningStaffPass)
);

/* ── LIST + CREATE ───────────────────────────────────────────────────────── */
router.get("/", auth, role(...ADMIN_ROLES), checkPermission("cleaning_staff", "view"), handle(getCleaningStaff));

router.post(
  "/",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "create"),
  upload.single("profile_picture"),
  handleProfilePictureUploadErrors,
  handle(createCleaningStaff)
);

/* ── NESTED SUB-RESOURCES (two segments, so no conflict with /:id) ────────── */
router.get(
  "/:id/passes",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "view"),
  handle(getCleaningStaffPasses)
);

router.post(
  "/:id/passes",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "create_passes"),
  handle(createCleaningStaffPass)
);



router.get(
  "/:id/attendance",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "view"),
  handle(getStaffAttendance)
);

/* ── SINGLE STAFF ────────────────────────────────────────────────────────── */
router.get("/:id", auth, role(...ADMIN_ROLES), checkPermission("cleaning_staff", "view"), handle(getCleaningStaffById));

router.put(
  "/:id",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "edit"),
  handle(updateCleaningStaff)
);

router.patch(
  "/:id/status",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "status"),
  handle(updateCleaningStaffStatus)
);

/* Hard delete is intentionally unavailable — see deleteCleaningStaffNotAllowed. */
router.delete(
  "/:id",
  auth,
  role(...ADMIN_ROLES),
  checkPermission("cleaning_staff", "status"),
  handle(deleteCleaningStaffNotAllowed)
);

module.exports = router;