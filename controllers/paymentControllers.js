


const { Op } = require("sequelize");
const crypto = require("crypto");
const { Bill, Payment, AmenityBooking, Amenity, FlatMembership } = require("../models");
const razorpay = require("../utils/razorpay");

/* ─── Demo UPI payment helper (mirrors amenityController.buildUpiPaymentData) ─── */
function buildBillUpiData(bill) {
  const upiId   = process.env.DEMO_UPI_ID   || "society@upi";
  const upiName = process.env.DEMO_UPI_NAME || "Society Payment";
  const amount  = Number(bill.amount) || 0;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount}&cu=INR`;
  return { upiId, upiName, amount, upiLink, bill_id: bill.id };
}

/* ─── Resolve a pending bill that belongs to the current user's flats ─── */
async function findOwnedPendingBill(billId, userId) {
  const memberships = await FlatMembership.findAll({
    where: { user_id: userId, is_current: true },
    attributes: ["flat_id"],
  });
  const myFlatIds = memberships.map((m) => m.flat_id);
  if (myFlatIds.length === 0) return null;

  const bill = await Bill.findOne({
    where: { id: billId, flat_id: { [Op.in]: myFlatIds } },
  });
  return bill;
}

/* === CREATE DEMO UPI PAYMENT DETAILS === */
const createDemoUpi = async (req, res) => {
  try {
    const { bill_id } = req.body;
    if (!bill_id) {
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }

    const bill = await findOwnedPendingBill(bill_id, req.user.id);

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }
    if (bill.status === "PAID") {
      return res.status(400).json({ success: false, message: "Bill is already paid" });
    }

    return res.status(200).json({ success: true, data: buildBillUpiData(bill) });
  } catch (err) {
    console.error("Create Demo UPI Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* === VERIFY DEMO UPI PAYMENT (marks bill PAID) === */
const verifyDemoPayment = async (req, res) => {
  try {
    const { bill_id } = req.body;
    if (!bill_id) {
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }

    const bill = await findOwnedPendingBill(bill_id, req.user.id);

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    if (bill.status === "PAID" || bill.status === "PENDING_VERIFICATION") {
      return res.status(400).json({ success: false, message: "Payment already submitted or paid" });
    }

    await Payment.create({
      bill_id: bill.id,
      amount: bill.amount,
      payment_mode: "UPI",
    });

    await bill.update({ status: "PENDING_VERIFICATION" });

    return res.status(200).json({ success: true, message: "Payment submitted successfully. Awaiting Admin confirmation." });
  } catch (err) {
    console.error("Verify Demo UPI Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};



const createOrder = async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ success: false, message: "Payment gateway not configured." });
    }

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

      if (bill.status === "PAID" || bill.status === "PENDING_VERIFICATION") {
        return res.status(400).json({
          success: false,
          message: "Already submitted or paid",
        });
      }

      await Payment.create({
        bill_id,
        amount: bill.amount,
        payment_mode: "RAZORPAY",
      });

      await bill.update({ status: "PENDING_VERIFICATION" });
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
  createDemoUpi,
  verifyDemoPayment,
};