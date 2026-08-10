require('dotenv').config();

console.log("═══════════════════════════════════");
console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID || "❌ MISSING");
console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "✅ SET (length: " + process.env.RAZORPAY_KEY_SECRET.length + ")" : "❌ MISSING");
console.log("═══════════════════════════════════");

const Razorpay = require("razorpay");

const rzp = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

rzp.orders.create({
  amount:   100000,   // ₹1000 in paise
  currency: "INR",
  receipt:  "test_001",
})
.then((order) => {
  console.log("✅ ORDER CREATED SUCCESSFULLY!");
  console.log("Order ID:", order.id);
  console.log("Amount:", order.amount);
  console.log("\nRazorpay is working fine. Problem is elsewhere.");
})
.catch((err) => {
  console.log("❌ RAZORPAY ERROR:");
  console.log("Error Code:", err.statusCode);
  console.log("Error Message:", err.error?.description || err.message);
  console.log("\nFull error:", JSON.stringify(err, null, 2));
});