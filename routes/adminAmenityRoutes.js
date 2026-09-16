
const express = require("express");
const router  = express.Router();

const {
  createAmenity,
  updateAmenity,
  toggleAmenity,
  disableAmenity,
  getAllBookings,
  getPendingBookings,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getAdminAvailability,
} = require("../controllers/adminAmenityController");

const protect          = require("../middlewares/authMiddleware");
const adminOnly        = require("../middlewares/adminMiddleware");
const role             = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

// All routes require auth + admin-role access (view-allowed incl. committee)
router.use(protect, adminOnly);

/* AMENITY CONFIGURATION (write = SOCIETY_ADMIN/SUPER_ADMIN/COMMITTEE_MEMBER) */
router.post   ("/",               role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "create"), createAmenity);
router.put    ("/:id",            role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), updateAmenity);
router.patch  ("/:id/toggle",     role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), toggleAmenity);   // Re-enable (clears disable metadata)
router.patch  ("/:id/disable",    role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), checkPermission("amenities", "edit"), disableAmenity);  // Disable with reason/type/dates

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