
const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/amenityController");
const protect    = require("../middlewares/authMiddleware");

// All routes require authentication
router.use(protect);

/* ── Amenity discovery ── */
router.get("/",                    controller.getAllAmenities);
router.get("/:id/availability",    controller.getAmenityAvailability);
router.get("/:id/booked-dates",    controller.getBookedDates);

/* ── Booking lifecycle ── */
router.post("/book",               controller.createBooking);        // create booking (+ Razorpay order if PAID)
router.post("/verify-payment",     controller.verifyPayment);        // confirm payment after Razorpay checkout
router.post("/:id/repay",          controller.repayBooking);         // re-initiate payment for PAYMENT_PENDING booking
router.put("/:id/cancel",          controller.cancelBooking);        // resident cancels

/* ── My bookings (includes PAYMENT_PENDING for repay UI) ── */
router.get("/my-bookings",         controller.getMyBookings);

module.exports = router;