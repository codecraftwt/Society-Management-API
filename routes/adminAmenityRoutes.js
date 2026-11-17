const express = require("express");
const router  = express.Router();

const {
  createAmenity,
  updateAmenity,
  toggleAmenity,
  disableAmenity,
  deleteAmenity,
  getAllBookings,
  getPendingBookings,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getAdminAvailability,
} = require("../controllers/adminAmenityController");

const {
  createRule,
  getAllRules,
  updateRule,
  deleteRule,
} = require("../controllers/amenityRulesController");

const protect          = require("../middlewares/authMiddleware");
const adminOnly        = require("../middlewares/adminMiddleware");
const role             = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
const upload           = require("../middlewares/uploadNotice");

// All routes require auth + admin-role access (view-allowed incl. committee)
router.use(protect, adminOnly);

/* AMENITY CONFIGURATION (write = SOCIETY_ADMIN/SUPER_ADMIN/COMMITTEE_MEMBER) */
router.post   ("/",               role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "create"), createAmenity);
router.put    ("/:id",            role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), updateAmenity);
router.patch  ("/:id/toggle",     role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), toggleAmenity);   // Re-enable (clears disable metadata)
router.patch  ("/:id/disable",    role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), disableAmenity);  // Disable with reason/type/dates
router.delete ("/:id",             role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "delete"), deleteAmenity);

/* AMENITIES RULES & TERMS MANAGEMENT */
router.post   ("/rules",          role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "create"), upload("amenities/rules").array("files", 5), createRule);
router.get    ("/rules",          checkPermission("amenities", "view"), getAllRules);
router.put    ("/rules/:id",      role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), upload("amenities/rules").array("files", 5), updateRule);
router.delete ("/rules/:id",      role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "delete"), deleteRule);

/* BOOKING MANAGEMENT (read) */
router.get("/bookings",         checkPermission("amenities", "view"), getAllBookings);
router.get("/bookings/pending", checkPermission("amenities", "view"), getPendingBookings);

/* WORKFLOW ACTIONS (write = SOCIETY_ADMIN/COMMITTEE_MEMBER/SUPER_ADMIN) */
router.put("/bookings/:id/approve", role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "manage_bookings"), approveBooking);
router.put("/bookings/:id/reject",  role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "manage_bookings"), rejectBooking);
router.put("/bookings/:id/cancel",  role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "manage_bookings"), cancelBooking);

/* INSIGHTS */
router.get("/:id/availability", checkPermission("amenities", "view"), getAdminAvailability);

module.exports = router;
