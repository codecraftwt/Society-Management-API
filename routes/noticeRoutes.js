const express = require("express");
const router  = express.Router();

const auth   = require("../middlewares/authMiddleware");
const role   = require("../middlewares/roleMiddleware");
const upload = require("../middlewares/uploadNotice");          // ← shared upload

const {
  createNotice,
  updateNotice,
  deleteNotice,
  getNotices
} = require("../controllers/noticeControllers");

// POST /api/notices  — create notice
router.post(
  "/",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  upload("notices").single("file"),
  createNotice
);

// PUT /api/notices/:id — update notice
router.put(
  "/:id",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  upload("notices").single("file"),
  updateNotice
);

// DELETE /api/notices/:id — delete notice
router.delete(
  "/:id",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  deleteNotice
);

// GET /api/notices
router.get(
  "/",
  auth,
  role("SUPER_ADMIN", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "FAMILY_MEMBER"),
  getNotices
);

module.exports = router;