const { Op } = require("sequelize");
const crypto = require("crypto");
const {
  Bill,
  BillLateFeeWaiver,
  Payment,
  AmenityBooking,
  Amenity,
  Flat,
  Block,
  Society,
  FlatMembership,
  SocietyFinancialAccount,
} = require("../models");
const razorpay = require("../utils/razorpay");
const sequelize = require("../config/db");
const { getUserAuthorizedFlatIds } = require("../utils/accessHelpers");
const { getDefaultBankAccount } = require("../utils/ledgerService");
const { calculateLateFee } = require("../utils/lateFeeHelper");

async function checkPaymentPermission() {
  return true;
}

/* ─── Resolve receiving bank account at payment initiation ─── */
async function resolveInitiationBankAccount(societyId, preferredAccountId = null, transaction = null) {
  const opts = transaction ? { transaction } : {};
  if (preferredAccountId) {
    const preferred = await SocietyFinancialAccount.findOne({
      where: { id: preferredAccountId, society_id: societyId, status: "ACTIVE" },
      ...opts,
    });
    if (preferred && preferred.account_type !== "CASH") {
      return { account: preferred };
    }
  }
  const def = await getDefaultBankAccount(societyId, transaction);
  if (!def || def.account_type === "CASH" || def.status !== "ACTIVE") {
    return {
      error: "Online collection bank account is not configured for this society. Please contact society admin.",
    };
  }
  return { account: def };
}

/* ─── Demo UPI payment helper ─── */
function buildBillUpiData(bill, feeCalc = null) {
  const societyName = bill.Flat?.Block?.Society?.name || "Society Management";
  const upiId = process.env.DEMO_UPI_ID || "society@upi";
  const upiName = process.env.DEMO_UPI_NAME || societyName || "Society Payment";
  const calc = feeCalc || calculateLateFee(bill);
  const amount = calc.totalPayable;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount}&cu=INR`;
  return {
    upiId,
    upiName,
    amount,
    base_amount: calc.baseAmount,
    late_fee: calc.outstandingLateFee,
    waived_amount: calc.waivedAmount,
    total_payable: calc.totalPayable,
    overdue_months: calc.overdueMonths,
    upiLink,
    bill_id: bill.id,
    society_name: societyName,
    title: bill.title,
    bill_category: bill.bill_category,
    other_bill_type: bill.other_bill_type,
    type: bill.type,
    billing_month: bill.billing_month,
    due_date: bill.due_date,
    flat_number: bill.Flat?.flat_number,
    block_name: bill.Flat?.Block?.name,
  };
}

/* ─── Resolve a pending bill that belongs to the current user's flats ─── */
async function findOwnedPendingBill(billId, userId, societyId = null) {
  const myFlatIds = await getUserAuthorizedFlatIds(userId, societyId);
  if (myFlatIds.length === 0) return null;

  return Bill.findOne({
    where: { id: billId, flat_id: { [Op.in]: myFlatIds } },
    include: [
      {
        model: Flat,
        include: [
          {
            model: Block,
            include: [{ model: Society, attributes: ["id", "name"] }],
          },
        ],
      },
    ],
  });
}

/* === CREATE DEMO UPI PAYMENT DETAILS (Snapshots financial_account_id at initiation) === */
const createDemoUpi = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!(await checkPaymentPermission(req.user))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "You do not have permission to make bill payments for this flat" });
    }
    const { bill_id } = req.body;
    if (!bill_id) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }

    const bill = await findOwnedPendingBill(bill_id, req.user.id, req.user.society_id);
    if (!bill) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Bill not found" });
    }
    if (bill.status === "PAID") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Bill is already paid" });
    }

    const societyId = bill.society_id || bill.Flat?.Block?.society_id || req.user.society_id;
    const { account, error } = await resolveInitiationBankAccount(societyId, bill.financial_account_id, t);
    if (error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    if (!bill.financial_account_id) {
      await bill.update({ financial_account_id: account.id }, { transaction: t });
    }

    const source = bill.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";
    const waivers = await BillLateFeeWaiver.findAll({
      where: { bill_id: bill.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const feeCalc = calculateLateFee(bill, { waivers });

    const existingPayment = await Payment.findOne({
      where: { bill_id: bill.id, status: { [Op.in]: ["INITIATED", "PENDING"] } },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!existingPayment) {
      await Payment.create(
        {
          bill_id: bill.id,
          society_id: societyId,
          financial_account_id: account.id,
          resident_id: req.user.id,
          amount: feeCalc.totalPayable,
          base_amount: feeCalc.baseAmount,
          late_fee_amount: feeCalc.outstandingLateFee,
          waived_amount: feeCalc.waivedAmount,
          payment_mode: "UPI",
          source,
          status: "INITIATED",
        },
        { transaction: t }
      );
    } else if (existingPayment.status === "INITIATED") {
      await existingPayment.update(
        {
          financial_account_id: existingPayment.financial_account_id || account.id,
          amount: feeCalc.totalPayable,
          base_amount: feeCalc.baseAmount,
          late_fee_amount: feeCalc.outstandingLateFee,
          waived_amount: feeCalc.waivedAmount,
        },
        { transaction: t }
      );
    }

    await t.commit();
    return res.status(200).json({ success: true, data: buildBillUpiData(bill, feeCalc) });
  } catch (err) {
    await t.rollback();
    console.error("Create Demo UPI Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* === VERIFY DEMO UPI PAYMENT (submits payment for admin confirmation) === */
const verifyDemoPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!(await checkPaymentPermission(req.user))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "You do not have permission to make bill payments for this flat" });
    }
    const { bill_id } = req.body;
    if (!bill_id) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }

    const bill = await Bill.findByPk(Number(bill_id), {
      transaction: t,
      lock: t.LOCK.UPDATE,
      include: [{ model: Flat, include: [{ model: Block }] }],
    });

    if (!bill) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    const activeSocietyId = parseInt(req.user?.society_id, 10);
    const myFlatIds = await getUserAuthorizedFlatIds(
      req.user.id,
      Number.isInteger(activeSocietyId) && activeSocietyId > 0 ? activeSocietyId : null
    );
    if (!myFlatIds.includes(Number(bill.flat_id))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Bill not found for this resident" });
    }

    if (bill.status === "PAID" || bill.status === "PENDING_VERIFICATION") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Payment already submitted or paid" });
    }

    const societyId = bill.society_id || bill.Flat?.Block?.society_id || req.user.society_id;
    const source = bill.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";

    if (source === "MAINTENANCE") {
      const ownerMembership = await FlatMembership.findOne({
        where: { flat_id: bill.flat_id, user_id: req.user.id, role: "OWNER", is_current: true },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const isLegacyDirectOwner = Number(bill.Flat?.resident_id) === Number(req.user.id);
      if (!ownerMembership && !isLegacyDirectOwner) {
        await t.rollback();
        return res.status(403).json({ success: false, message: "Maintenance charges are payable by the owner." });
      }
    }

    const waivers = await BillLateFeeWaiver.findAll({
      where: { bill_id: bill.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const feeCalc = calculateLateFee(bill, { waivers });

    if (
      req.body?.expected_amount !== undefined &&
      req.body?.expected_amount !== null &&
      Math.abs(Number(req.body.expected_amount) - feeCalc.totalPayable) > 0.01
    ) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        amountMismatch: true,
        message: "Payable amount has changed due to updated late payment charges. Please refresh and try again.",
        total_payable: feeCalc.totalPayable,
      });
    }

    const existingPayment = await Payment.findOne({
      where: { bill_id: bill.id, status: "INITIATED" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let snapshotAccId = existingPayment?.financial_account_id || bill.financial_account_id || null;
    if (!snapshotAccId) {
      const { account, error } = await resolveInitiationBankAccount(societyId, null, t);
      if (error) {
        await t.rollback();
        return res.status(400).json({ success: false, message: error });
      }
      snapshotAccId = account.id;
    }

    if (existingPayment) {
      await existingPayment.update(
        {
          financial_account_id: snapshotAccId,
          resident_id: req.user.id,
          amount: feeCalc.totalPayable,
          base_amount: feeCalc.baseAmount,
          late_fee_amount: feeCalc.outstandingLateFee,
          waived_amount: feeCalc.waivedAmount,
          payment_mode: "UPI",
          payment_date: new Date(),
          source,
          status: "PENDING",
        },
        { transaction: t }
      );
    } else {
      await Payment.create(
        {
          bill_id: bill.id,
          society_id: societyId,
          financial_account_id: snapshotAccId,
          resident_id: req.user.id,
          amount: feeCalc.totalPayable,
          base_amount: feeCalc.baseAmount,
          late_fee_amount: feeCalc.outstandingLateFee,
          waived_amount: feeCalc.waivedAmount,
          payment_mode: "UPI",
          source,
          status: "PENDING",
        },
        { transaction: t }
      );
    }

    await bill.update({ status: "PENDING_VERIFICATION" }, { transaction: t });

    await t.commit();
    return res.status(200).json({ success: true, message: "Payment submitted successfully. Awaiting Admin confirmation." });
  } catch (err) {
    await t.rollback();
    console.error("Verify Demo UPI Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* === CREATE RAZORPAY ORDER (Snapshots financial_account_id at initiation) === */
const createOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (req.body.type !== "AMENITY" && !(await checkPaymentPermission(req.user))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "You do not have permission to make bill payments for this flat" });
    }
    const { bill_id, type } = req.body;
    if (!bill_id) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "bill_id is required" });
    }
    if (!razorpay) {
      await t.rollback();
      return res.status(503).json({ success: false, message: "Payment gateway not configured." });
    }

    let amount = 0;
    let feeCalc = null;
    let societyId = req.user.society_id;
    let preferredAccountId = null;
    let booking = null;
    let bill = null;

    if (type === "AMENITY") {
      booking = await AmenityBooking.findByPk(bill_id, {
        include: [{ model: Amenity }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!booking) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Amenity booking not found" });
      }
      societyId = booking.society_id || societyId;
      preferredAccountId = booking.financial_account_id || null;
      amount = booking.AmenityPayment || booking.Amenity?.rate_per_hour || 0;
    } else {
      bill = await Bill.findByPk(bill_id, {
        include: [{ model: Flat, include: [{ model: Block }] }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!bill) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Bill not found" });
      }
      if (bill.type === "MAINTENANCE" && String(req.user?.resident_type || "").toUpperCase() === "TENANT") {
        await t.rollback();
        return res.status(403).json({ success: false, message: "Tenants cannot pay maintenance bills. Please contact society management." });
      }
      societyId = bill.society_id || bill.Flat?.Block?.society_id || societyId;
      preferredAccountId = bill.financial_account_id || null;
      const waivers = await BillLateFeeWaiver.findAll({
        where: { bill_id: bill.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      feeCalc = calculateLateFee(bill, { waivers });
      amount = feeCalc.totalPayable;
    }

    if (!amount || isNaN(amount)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const { account, error } = await resolveInitiationBankAccount(societyId, preferredAccountId, t);
    if (error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `receipt_${bill_id}_${Date.now()}`,
    });

    if (type === "AMENITY" && booking) {
      await booking.update(
        {
          razorpay_order_id: order.id,
          financial_account_id: booking.financial_account_id || account.id,
        },
        { transaction: t }
      );
      const existingPay = await Payment.findOne({
        where: { amenity_booking_id: booking.id, status: "INITIATED" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (existingPay) {
        await existingPay.update(
          { razorpay_order_id: order.id, financial_account_id: existingPay.financial_account_id || account.id },
          { transaction: t }
        );
      } else {
        await Payment.create(
          {
            amenity_booking_id: booking.id,
            society_id: societyId,
            financial_account_id: account.id,
            resident_id: booking.user_id || req.user.id,
            amount,
            payment_mode: "RAZORPAY",
            razorpay_order_id: order.id,
            source: "AMENITY",
            status: "INITIATED",
          },
          { transaction: t }
        );
      }
    } else if (bill) {
      if (!bill.financial_account_id) {
        await bill.update({ financial_account_id: account.id }, { transaction: t });
      }
      const source = bill.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";
      const existingPay = await Payment.findOne({
        where: { bill_id: bill.id, status: "INITIATED" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (existingPay) {
        await existingPay.update(
          {
            razorpay_order_id: order.id,
            amount,
            base_amount: feeCalc?.baseAmount ?? bill.amount,
            late_fee_amount: feeCalc?.outstandingLateFee ?? 0,
            waived_amount: feeCalc?.waivedAmount ?? 0,
            financial_account_id: existingPay.financial_account_id || account.id,
          },
          { transaction: t }
        );
      } else {
        await Payment.create(
          {
            bill_id: bill.id,
            society_id: societyId,
            financial_account_id: account.id,
            resident_id: req.user.id,
            amount,
            base_amount: feeCalc?.baseAmount ?? bill.amount,
            late_fee_amount: feeCalc?.outstandingLateFee ?? 0,
            waived_amount: feeCalc?.waivedAmount ?? 0,
            payment_mode: "RAZORPAY",
            razorpay_order_id: order.id,
            source,
            status: "INITIATED",
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    return res.status(200).json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
      breakdown: feeCalc
        ? {
            base_amount: feeCalc.baseAmount,
            late_fee: feeCalc.outstandingLateFee,
            waived_amount: feeCalc.waivedAmount,
            total_payable: feeCalc.totalPayable,
          }
        : null,
    });
  } catch (err) {
    await t.rollback();
    console.error("Create Order Error:", err);
    const detail = (err && err.error && err.error.description) || (err && err.message) || "Payment gateway error";
    return res.status(500).json({ success: false, message: detail });
  }
};

/* === VERIFY RAZORPAY PAYMENT (Manual Admin Confirmation Required Before Ledger Credit) === */
const verifyPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bill_id,
      type,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Payment not completed properly" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    // Idempotency guard by razorpay_payment_id
    const duplicateRzp = await Payment.findOne({
      where: { razorpay_payment_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (duplicateRzp && ["PENDING", "SUCCESS"].includes(duplicateRzp.status)) {
      await t.commit();
      return res.status(200).json({ success: true, alreadyProcessed: true, message: "Payment already verified" });
    }

    /* === BILL / MAINTENANCE === */
    if (!type || type === "BILL") {
      const bill = await Bill.findByPk(bill_id, {
        include: [{ model: Flat, include: [{ model: Block }] }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!bill) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Bill not found" });
      }

      if (bill.status === "PAID" || bill.status === "PENDING_VERIFICATION") {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Already submitted or paid" });
      }

      const societyId = bill.society_id || bill.Flat?.Block?.society_id || req.user.society_id;
      const waivers = await BillLateFeeWaiver.findAll({
        where: { bill_id: bill.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const feeCalc = calculateLateFee(bill, { waivers });

      const initiated = await Payment.findOne({
        where: { bill_id: bill.id, status: "INITIATED" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (initiated && Number(initiated.amount) + 0.01 < feeCalc.totalPayable) {
        await initiated.update({ status: "FAILED" }, { transaction: t });
        await t.commit();
        return res.status(409).json({
          success: false,
          amountMismatch: true,
          message: "Order amount is outdated due to updated late payment charges. Please initiate a fresh payment.",
          expected_amount: feeCalc.totalPayable,
          order_amount: Number(initiated.amount),
        });
      }

      let snapshotAccId = initiated?.financial_account_id || bill.financial_account_id || null;
      if (!snapshotAccId) {
        const { account, error } = await resolveInitiationBankAccount(societyId, null, t);
        if (error) {
          await t.rollback();
          return res.status(400).json({ success: false, message: error });
        }
        snapshotAccId = account.id;
      }

      const source = bill.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";
      if (initiated) {
        await initiated.update(
          {
            financial_account_id: snapshotAccId,
            amount: feeCalc.totalPayable,
            base_amount: feeCalc.baseAmount,
            late_fee_amount: feeCalc.outstandingLateFee,
            waived_amount: feeCalc.waivedAmount,
            razorpay_order_id,
            razorpay_payment_id,
            transaction_ref: razorpay_payment_id,
            payment_date: new Date(),
            status: "PENDING",
          },
          { transaction: t }
        );
      } else {
        await Payment.create(
          {
            bill_id,
            society_id: societyId,
            financial_account_id: snapshotAccId,
            resident_id: req.user.id,
            amount: feeCalc.totalPayable,
            base_amount: feeCalc.baseAmount,
            late_fee_amount: feeCalc.outstandingLateFee,
            waived_amount: feeCalc.waivedAmount,
            payment_mode: "RAZORPAY",
            razorpay_order_id,
            razorpay_payment_id,
            transaction_ref: razorpay_payment_id,
            source,
            status: "PENDING",
          },
          { transaction: t }
        );
      }

      await bill.update({ status: "PENDING_VERIFICATION" }, { transaction: t });
    }

    /* === AMENITY (Follows Manual Admin Confirmation Workflow; NO Ledger Credit Yet) === */
    if (type === "AMENITY") {
      const booking = await AmenityBooking.findByPk(bill_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!booking) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Amenity booking not found" });
      }

      const existingDone = await Payment.findOne({
        where: { amenity_booking_id: booking.id, status: { [Op.in]: ["PENDING", "SUCCESS"] } },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (booking.payment_status === "PAID" || existingDone) {
        await t.commit();
        return res.status(200).json({
          success: true,
          alreadyProcessed: true,
          message: "Payment already submitted or confirmed",
        });
      }

      const initiated = await Payment.findOne({
        where: { amenity_booking_id: booking.id, status: "INITIATED" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      let snapshotAccId = initiated?.financial_account_id || booking.financial_account_id || null;
      if (!snapshotAccId) {
        const { account, error } = await resolveInitiationBankAccount(booking.society_id || req.user.society_id, null, t);
        if (error) {
          await t.rollback();
          return res.status(400).json({ success: false, message: error });
        }
        snapshotAccId = account.id;
      }

      await booking.update(
        {
          payment_status: "PENDING",
          status: booking.status === "PAYMENT_PENDING" ? "PENDING" : booking.status,
          razorpay_order_id,
          razorpay_payment_id,
          financial_account_id: snapshotAccId,
        },
        { transaction: t }
      );

      if (initiated) {
        await initiated.update(
          {
            financial_account_id: snapshotAccId,
            razorpay_order_id,
            razorpay_payment_id,
            transaction_ref: razorpay_payment_id,
            payment_date: new Date(),
            status: "PENDING",
          },
          { transaction: t }
        );
      } else {
        await Payment.create(
          {
            amenity_booking_id: booking.id,
            society_id: booking.society_id,
            financial_account_id: snapshotAccId,
            resident_id: booking.user_id,
            amount: booking.AmenityPayment || null,
            payment_mode: "RAZORPAY",
            razorpay_order_id,
            razorpay_payment_id,
            transaction_ref: razorpay_payment_id,
            source: "AMENITY",
            status: "PENDING",
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    return res.status(200).json({
      success: true,
      message: "Payment verified and submitted for Admin confirmation.",
    });
  } catch (err) {
    await t.rollback();
    console.error("Verify Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  createDemoUpi,
  verifyDemoPayment,
  resolveInitiationBankAccount,
};
