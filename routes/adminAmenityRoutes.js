
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

const protect              = require("../middlewares/authMiddleware");
const adminOnly = require("../middlewares/adminMiddleware");

// All routes require auth + admin role
router.use(protect, adminOnly);

/* ── AMENITY CONFIGURATION ── */
router.post   ("/",               createAmenity);
router.put    ("/:id",            updateAmenity);
router.patch  ("/:id/toggle",     toggleAmenity);   // Re-enable (clears disable metadata)
router.patch  ("/:id/disable",    disableAmenity);  // Disable with reason/type/dates

/* ── BOOKING MANAGEMENT ── */
router.get("/bookings",         getAllBookings);
router.get("/bookings/pending", getPendingBookings);

/* ── WORKFLOW ACTIONS ── */
router.put("/bookings/:id/approve", approveBooking);
router.put("/bookings/:id/reject",  rejectBooking);
router.put("/bookings/:id/cancel",  cancelBooking);

/* ── INSIGHTS ── */
router.get("/:id/availability", getAdminAvailability);

module.exports = router;