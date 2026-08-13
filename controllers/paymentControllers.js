


const crypto = require("crypto");
const { Bill, Payment, AmenityBooking, Amenity } = require("../models");
const razorpay = require("../utils/razorpay");



const createOrder = async (req, res) => {
  try {
    const { bill_id, type } = req.body;

    if (!bill_id) {
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }

    let amount = 0;

    if (type === "AMENITY") {
      const booking = await AmenityBooking.findByPk(bill_id, {
        include: [{ model: Amenity }],
      });

      if (!booking)
        return res.status(404).json({ success: false, message: "Amenity booking not found" });

      amount = booking.Amenity?.rate_per_hour || 0;

    } else {
      const bill = await Bill.findByPk(bill_id);

      if (!bill)
        return res.status(404).json({ success: false, message: "Bill not found" });

      amount = bill.amount;
    }

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `receipt_${bill_id}_${Date.now()}`,
    });

    return res.status(200).json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
    });

  } catch (err) {
    console.error("Create Order Error:", err);
    const detail = (err && (err.error && err.error.description)) || (err && err.message) || "Payment gateway error";
    return res.status(500).json({
      success: false,
      message: detail,
    });
  }
};

/* === VERIFY RAZORPAY PAYMENT === */
const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bill_id,
      type,
    } = req.body;

    /* 🚨 IMPORTANT CHECK */
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment not completed properly",
      });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    /* 🚨 STRICT SIGNATURE MATCH */
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    /* === BILL === */
    if (!type || type === "BILL") {
      const bill = await Bill.findByPk(bill_id);

      if (!bill)
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });

      if (bill.status === "PAID") {
        return res.status(400).json({
          success: false,
          message: "Already paid",
        });
      }

      await Payment.create({
        bill_id,
        amount: bill.amount,
        payment_mode: "RAZORPAY",
      });

      await bill.update({ status: "PAID" });
    }

    /* === AMENITY === */
    if (type === "AMENITY") {
      const booking = await AmenityBooking.findByPk(bill_id);

      if (!booking)
        return res.status(404).json({
          success: false,
          message: "Amenity booking not found",
        });

      if (booking.payment_status === "PAID") {
        return res.status(400).json({
          success: false,
          message: "Already paid",
        });
      }

      booking.payment_status = "PAID";
      booking.status = "APPROVED";
      await booking.save();
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
    });

  } catch (err) {
    console.error("Verify Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
};