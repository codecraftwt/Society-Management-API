
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

// All routes require auth + admin-role access (view-allowed incl. committee)
router.use(protect, adminOnly);

/* AMENITY CONFIGURATION (write = SOCIETY_ADMIN/SUPER_ADMIN/COMMITTEE_MEMBER) */
router.post   ("/",               role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), createAmenity);
router.put    ("/:id",            role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), updateAmenity);
router.patch  ("/:id/toggle",     role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), toggleAmenity);   // Re-enable (clears disable metadata)
router.patch  ("/:id/disable",    role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), disableAmenity);  // Disable with reason/type/dates

/* BOOKING MANAGEMENT (read) */
router.get("/bookings",         getAllBookings);
router.get("/bookings/pending", getPendingBookings);

/* WORKFLOW ACTIONS (write = SOCIETY_ADMIN/COMMITTEE_MEMBER/SUPER_ADMIN) */
router.put("/bookings/:id/approve", role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), approveBooking);
router.put("/bookings/:id/reject",  role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), rejectBooking);
router.put("/bookings/:id/cancel",  role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), cancelBooking);

/* INSIGHTS */
router.get("/:id/availability", getAdminAvailability);

module.exports = router;