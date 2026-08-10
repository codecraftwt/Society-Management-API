
const express = require("express");
const router  = express.Router();

const auth    = require("../middlewares/authMiddleware");
const role    = require("../middlewares/roleMiddleware");
const upload  = require("../middlewares/uploadComplaint");
const uploadAttachment = require("../middlewares/uploadCommentAttachment");

const {
  getComplaints,
  updateStatus,
  createComplaint,
  getMyComplaints,
  deleteComplaint,
} = require("../controllers/complaintControllers");

const {
  getComments,
  postComment,
  deleteComment,
  clearComments,
  markComplaintRead, // ✅ NEW IMPORT
} = require("../controllers/complaintCommentControllers");


/* =====
   IMPORTANT: "/my" must come BEFORE "/:id"
===== */

// ✅ Resident - Get My Complaints (with unread_count)
router.get(
  "/my",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  getMyComplaints
);


/* =====
   ADMIN ROUTES
===== */

// ✅ Admin - Get All Complaints (with unread_count)
router.get(
  "/",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  getComplaints
);

// ✅ Admin - Update Status
router.put(
  "/:id",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  updateStatus
);


/* =====
   RESIDENT ROUTES
===== */

// ✅ Create Complaint
router.post(
  "/",
  auth,
  role("RESIDENT"),
  upload.single("photo"),
  createComplaint
);

// ✅ Delete Complaint
router.delete(
  "/:id",
  auth,
  role("RESIDENT"),
  deleteComplaint
);


/* =====
   COMMENTS ROUTES
===== */

// ✅ Get Comments
router.get(
  "/:id/comments",
  auth,
  getComments
);

// ✅ Post Comment
router.post(
  "/:id/comments",
  auth,
  uploadAttachment.single("attachment"),
  postComment
);

// ✅ Clear All Comments
router.delete(
  "/:id/comments",
  auth,
  clearComments
);

// ✅ Delete Single Comment
router.delete(
  "/:id/comments/:commentId",
  auth,
  deleteComment
);


/* =====
   ✅ NEW: MARK COMPLAINT AS READ
===== */

// ✅ Mark Complaint as Read (Admin + Resident)
router.put(
  "/:id/read",
  auth,
  markComplaintRead
);


module.exports = router;