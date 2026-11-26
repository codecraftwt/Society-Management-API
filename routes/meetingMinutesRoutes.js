const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/meetingCategoryController");

const {
  getEligibleMembers,
  listMeetings,
  getMeetingById,
  createMeeting,
  updateMeeting,
  deleteMeeting,
} = require("../controllers/meetingMinutesController");

const momRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"];

router.use(auth, role(...momRoles));

// Categories
router.get("/categories", checkPermission("meeting_minutes", "view"), listCategories);
router.post("/categories", checkPermission("meeting_minutes", "create"), createCategory);
router.put("/categories/:id", checkPermission("meeting_minutes", "edit"), updateCategory);
router.delete("/categories/:id", checkPermission("meeting_minutes", "delete"), deleteCategory);

// Eligible members for attendance (paginated & role-filtered)
router.get("/eligible-members", checkPermission("meeting_minutes", "view"), getEligibleMembers);

// Meeting Minutes CRUD
router.get("/", checkPermission("meeting_minutes", "view"), listMeetings);
router.get("/:id", checkPermission("meeting_minutes", "view"), getMeetingById);
router.post("/", checkPermission("meeting_minutes", "create"), createMeeting);
router.put("/:id", checkPermission("meeting_minutes", "edit"), updateMeeting);
router.delete("/:id", checkPermission("meeting_minutes", "delete"), deleteMeeting);

module.exports = router;
