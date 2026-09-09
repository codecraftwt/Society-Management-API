const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const upload = require("../middlewares/uploadNotice");

const {
  createNotice,
  updateNotice,
  deleteNotice,
  getNotices,
  viewNotice,
  acknowledgeNotice,
  getNoticeAcknowledgements,
} = require("../controllers/noticeControllers");

// POST /api/notices — create notice
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

// GET /api/notices — list notices
router.get(
  "/",
  auth,
  role("SUPER_ADMIN", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "FAMILY_MEMBER"),
  getNotices
);

// POST /api/notices/:id/view — record notice viewed timestamp
router.post(
  "/:id/view",
  auth,
  role("SUPER_ADMIN", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "FAMILY_MEMBER"),
  viewNotice
);

// POST /api/notices/:id/acknowledge — mark notice as read / acknowledged
router.post(
  "/:id/acknowledge",
  auth,
  role("SUPER_ADMIN", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "FAMILY_MEMBER"),
  acknowledgeNotice
);

// GET /api/notices/:id/acknowledgements — get acknowledgement history report (Admin/Committee only)
router.get(
  "/:id/acknowledgements",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  getNoticeAcknowledgements
);

module.exports = router;