const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/amenityController");
const rulesController = require("../controllers/amenityRulesController");
const protect    = require("../middlewares/authMiddleware");
const enforceRulesAcknowledged = require("../middlewares/enforceRulesAcknowledged");

// All routes require authentication
router.use(protect);

/* ── Amenity discovery ── */
router.get("/",                    controller.getAllAmenities);
router.get("/:id/availability",    controller.getAmenityAvailability);
router.get("/:id/booked-dates",    controller.getBookedDates);

/* ── Amenities Rules & Terms (Resident) ── */
router.get("/rules/published",     rulesController.getPublishedRules);
router.get("/bookings/:id/accepted-terms", rulesController.getBookingAcceptedTerms);

/* ── Booking lifecycle ── */
router.post("/book",               enforceRulesAcknowledged, controller.createBooking);        // create booking (+ Razorpay order if PAID)
router.post("/verify-payment",     controller.verifyPayment);        // confirm payment after Razorpay checkout
router.post("/:id/repay",          controller.repayBooking);         // re-initiate payment for PAYMENT_PENDING booking
router.put("/:id/cancel",          controller.cancelBooking);        // resident cancels

/* ── My bookings (includes PAYMENT_PENDING for repay UI) ── */
router.get("/my-bookings",         controller.getMyBookings);

module.exports = router;
