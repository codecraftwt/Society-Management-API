const express = require("express");
const Bill = require("../models/Bill");
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

/* === DEBUG === */

router.get("/debug-bills", async (req, res) => {
  const bills = await Bill.findAll();
  res.json(bills);
});

module.exports = router;