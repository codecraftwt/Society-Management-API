const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  createOrder,
  verifyPayment,
  createDemoUpi,
  verifyDemoPayment,
} = require("../controllers/paymentControllers");

/* === RAZORPAY === */

router.post("/create-order", auth, role("RESIDENT"), createOrder);

router.post("/verify", auth, role("RESIDENT"), verifyPayment);

/* === DEMO UPI === */

router.post("/demo-upi", auth, role("RESIDENT"), createDemoUpi);

router.post("/demo-verify", auth, role("RESIDENT"), verifyDemoPayment);

/* Note: the former unauthenticated `GET /debug-bills` endpoint was removed.
   It returned every bill in every society with no authentication, exposing
   cross-tenant financial data. Nothing in Web, Mobile or the API depended on
   it (only a test asserted its existence). */

module.exports = router;