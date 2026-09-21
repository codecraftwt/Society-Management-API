const { User, Block, HouseHoldMember, Society, FlatMembership } = require("../models");

const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Floor = require("../models/Floor");
const Notification = require("../models/Notification");
const UserSetting = require("../models/UserSetting");
const Payment = require("../models/Payment");
const { sendPushNotification } = require("../utils/pushNotification");
const { createLedgerEntry } = require("../utils/ledgerService");
const sequelize = require("../config/db");

const { Op } = require("sequelize");

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/* =====
   CREATE BILL
===== */
const createBill = async (req, res) => {
  try {
    const { 
      flat_id, 
      title, 
      amount, 
      billing_month, 
      bill_type, 
      flat_type, 
      bill_category, 
      other_bill_type, 
      issue_date, 
      last_pay_date 
    } = req.body;

    const parsedAmount = Number(amount);
    if (amount === undefined || amount === null || amount === "" || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        message: "Bill amount must be a valid number greater than 0.",
      });
    }

    const targetFlatType = (flat_type || bill_type || "INDIVIDUAL").toUpperCase();
    const finalCategory = (bill_category || "OTHER").toUpperCase();
    const finalOtherType = finalCategory === "OTHER" ? (other_bill_type || null) : null;

    const finalIssueDate = issue_date || todayIso();
    const finalDueDate = last_pay_date || addDays(30);

    /* ==== INDIVIDUAL BILL ==== */
    if (targetFlatType === "INDIVIDUAL") {

      const flat = await Flat.findByPk(flat_id);

      let residentId = flat?.resident_id;
      if (!residentId && flat_id) {
        const membership = await FlatMembership.findOne({
          where: { flat_id, is_current: true },
        });
        residentId = membership?.user_id;
      }

      if (!residentId) {
        return res.status(400).json({
          message: "Cannot create bill. No resident assigned to this flat.",
        });
      }

      // Block billing for tenant-occupied flats
      if (flat?.occupancy_status === "RENTED") {
        return res.status(400).json({
          message: "Cannot create bill for a tenant-occupied flat. Only owner-occupied flats are billed.",
        });
      }

      const bill = await Bill.create({
        flat_id,
        resident_id: residentId,
        title,
        amount,
        billing_month,
        bill_category: finalCategory,
        other_bill_type: finalOtherType,
        issue_date: finalIssueDate,
        due_date: finalDueDate,
        last_pay_date: finalDueDate,
      });

      const userIdsToNotify = new Set();
      if (residentId) userIdsToNotify.add(residentId);

      const adminMembers = await HouseHoldMember.findAll({
        where: { flat_id: flat.id, isAdmin: true },
      });
      for (let member of adminMembers) {
        if (member.user_id) userIdsToNotify.add(member.user_id);
      }

      const usersToNotify = await User.findAll({
        where: { id: { [Op.in]: Array.from(userIdsToNotify) } },
        attributes: ["id", "fcm_token"],
      });

      for (const user of usersToNotify) {
        const settings = await UserSetting.findOne({ where: { user_id: user.id } });
        if (!settings || settings.payment_updates !== false) {
          const notification = await Notification.create({
            title: "Bill Payment Pending",
            message: `⚡ Your ${title} bill of ₹${amount} is waiting for payment`,
            type: "BILL",
            action_type: "BILL_PAYMENT",
            action_route: "/resident/bills",
            society_id: req.user.society_id,
            receiver_user_id: user.id,
          });

          if (global.io) {
            global.io.to(`user_${user.id}`).emit("new_notification", notification);
          }

          if (user.fcm_token) {
            sendPushNotification(
              user.fcm_token,
              "New Maintenance Bill",
              `⚡ A new bill of ₹${amount} for ${title} has been generated.`,
              { route: "/resident/bills", billId: bill.id.toString() }
            ).catch((err) => console.error("Push Error:", err));
          }
        }
      }

      return res.status(200).json(bill);
    }

    /* ==== ALL FLATS BILL ==== */
    if (targetFlatType === "ALL") {

      // Only bill owner-occupied flats — exclude RENTED (tenant) flats
      const flats = await Flat.findAll({
        where: {
          occupancy_status: { [Op.in]: ["OWNER_OCCUPIED"] },
        },
        include: [
          {
            model: Block,
            where: { society_id: req.user.society_id },
            attributes: [],
          },
          {
            model: FlatMembership,
            required: false,
            where: { is_current: true },
            include: [{ model: User, attributes: ["id", "fcm_token"] }],
          },
        ],
      });

      const createdBills = [];

      for (let flat of flats) {
        const activeMember = flat.FlatMemberships?.find(m => m.is_current) || flat.FlatMemberships?.[0];
        const residentId = activeMember?.user_id || flat.resident_id;

        if (!residentId) continue;

        const bill = await Bill.create({
          flat_id: flat.id,
          resident_id: residentId,
          title,
          amount,
          billing_month,
          bill_category: finalCategory,
          other_bill_type: finalOtherType,
          issue_date: finalIssueDate,
          due_date: finalDueDate,
          last_pay_date: finalDueDate,
        });

        createdBills.push(bill);

        const user = activeMember?.User || (residentId ? await User.findByPk(residentId, { attributes: ["id", "fcm_token"] }) : null);
        const settings = residentId ? await UserSetting.findOne({ where: { user_id: residentId } }) : null;

        if (!settings || settings.payment_updates !== false) {
          const notification = await Notification.create({
            title: "Bill Payment Pending",
            message: `⚡ Your ${title} bill of ₹${amount} is waiting for payment`,
            type: "BILL",
            action_type: "BILL_PAYMENT",
            action_route: "/resident/bills",
            society_id: req.user.society_id,
            receiver_role: "RESIDENT",
            receiver_user_id: residentId,
          });

          if (global.io) {
            global.io.to(`user_${residentId}`).emit("new_notification", notification);
          }

          if (user && user.fcm_token) {
            sendPushNotification(
              user.fcm_token,
              "New Maintenance Bill",
              `⚡ A new bill of ₹${amount} for ${title} has been generated.`,
              { route: "/resident/bills", billId: bill.id.toString() }
            ).catch((err) => console.error("Push Error:", err));
          }
        }
      }

      return res.status(200).json({
        message: "Bills created for all owner-occupied flats",
        total: createdBills.length,
      });
    }

    return res.status(400).json({ message: "Invalid bill type" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* =====
   GET SOCIETY BILLS (ADMIN)  ← PAGINATION + SEARCH + FILTER
===== */
const getSocietyBills = async (req, res) => {
  try {
    // ── Pagination ──
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // ── Search ──
    const search = req.query.search?.trim() || "";

    // ── Filter: ALL | PAID | PENDING ──
    const filter = req.query.filter || "ALL";

    // ── Filter: category / type ──
    const category = req.query.category || req.query.type;

    // ── Society scope ──
    const targetSocId = req.headers["x-society-id"] || req.query.society_id || req.user.society_id;
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !targetSocId;

    // ── Status & Society WHERE ──
    const billWhere = {};

    if (filter === "PAID") billWhere.status = "PAID";
    else if (filter === "PENDING") billWhere.status = "PENDING";
    else if (filter === "PENDING_VERIFICATION") billWhere.status = "PENDING_VERIFICATION";

    let targetFlatIds = null;
    if (!isGlobalSuperAdmin && targetSocId) {
      const societyBlocks = await Block.findAll({
        where: { society_id: targetSocId },
        attributes: ["id"],
      });
      const blockIds = societyBlocks.map(b => b.id);
      if (blockIds.length > 0) {
        const flats = await Flat.findAll({
          where: { block_id: { [Op.in]: blockIds } },
          attributes: ["id"],
        });
        targetFlatIds = flats.map(f => f.id);
      } else {
        targetFlatIds = [];
      }
      billWhere.flat_id = { [Op.in]: targetFlatIds };
    }

    if (category && category !== "ALL") {
      if (category === "MAINTENANCE") {
        billWhere[Op.or] = [
          { type: "MAINTENANCE" },
          { bill_category: "MAINTENANCE" },
          { title: { [Op.like]: "%Maintenance%" } },
        ];
      } else {
        billWhere[Op.or] = [
          { bill_category: category },
          { type: category },
        ];
      }
    }

    // ── Search: title, billing_month, or other_bill_type ──
    if (search) {
      billWhere[Op.or] = [
        ...(billWhere[Op.or] || []),
        { title:           { [Op.like]: `%${search}%` } },
        { billing_month:   { [Op.like]: `%${search}%` } },
        { other_bill_type: { [Op.like]: `%${search}%` } },
        { bill_category:   { [Op.like]: `%${search}%` } },
      ];
    }

    const flatInclude = {
      model:      Flat,
      required:   false,
      attributes: ["id", "flat_number", "floor_id", "block_id"],
      include: [
        { model: Block, required: false, attributes: ["id", "name"], include: [{ model: Society, attributes: ["id", "name"] }] },
        { model: Floor, required: false, attributes: ["id", "floor_number"], include: [{ model: Block, required: false, attributes: ["id", "name"] }] },
        {
          model: FlatMembership,
          required: false,
          where: { is_current: true },
          include: [{ model: User, required: false, attributes: ["id", "name", "email", "phone"] }],
        },
      ],
    };

    const paymentInclude = {
      model: Payment,
      required: false,
      attributes: ["id", "amount", "payment_mode", "payment_date", "source", "status", "resident_id"],
      include: [
        {
          model: User,
          as: "resident",
          required: false,
          attributes: ["id", "name", "email", "phone"],
        },
      ],
    };

    // ── Paginated query ──
    const { count, rows: bills } = await Bill.findAndCountAll({
      where:    billWhere,
      include:  [flatInclude, paymentInclude],
      order:    [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
      col:      "id",
    });

    // ── Unfiltered counts for stat strip & tab badges ──
    const allBillsForCounts = await Bill.findAll({
      attributes: ["id", "status", "amount"],
      where: targetFlatIds !== null ? { flat_id: { [Op.in]: targetFlatIds } } : {},
    });

    const totalAll                 = allBillsForCounts.length;
    const totalPaid                = allBillsForCounts.filter(b => b.status === "PAID").length;
    const totalPending             = allBillsForCounts.filter(b => b.status === "PENDING").length;
    const totalPendingVerification = allBillsForCounts.filter(b => b.status === "PENDING_VERIFICATION").length;
    const totalRevenue             = allBillsForCounts
      .filter(b => b.status === "PAID")
      .reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalPendingAmount       = allBillsForCounts
      .filter(b => b.status !== "PAID")
      .reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalAllAmount           = allBillsForCounts
      .reduce((s, b) => s + Number(b.amount || 0), 0);

    const formattedBills = bills.map((bill) => {
      const b = bill.toJSON ? bill.toJSON() : bill;
      if (b.Flat) {
        const activeMember = b.Flat.FlatMemberships?.find((m) => m.is_current) || b.Flat.FlatMemberships?.[0];
        b.Flat.User = activeMember?.User || null;
        if (!b.User) {
          b.User = activeMember?.User || null;
        }
      }
      return b;
    });

    res.status(200).json({
      data: formattedBills,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        total:               totalAll,
        paid:                totalPaid,
        pending:             totalPending,
        pendingVerification: totalPendingVerification,
        revenue:             totalRevenue,
        pendingAmount:       totalPendingAmount,
        totalAmount:         totalAllAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET RESIDENT BILLS  ← PAGINATION + SERVER SEARCH + SERVER FILTER
===== */
const getResidentBills = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find ALL flats this user is actively associated with
    const FlatMembership = require("../models/FlatMembership");
    const userMemberships = await FlatMembership.findAll({
      where:      { user_id: userId, is_current: true },
      attributes: ["flat_id"],
    });

    const myFlatIds = userMemberships.map(m => m.flat_id);

    // ── Pagination ──
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    if (myFlatIds.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: { currentPage: page, totalPages: 0, totalItems: 0, limit },
        counts: { total: 0, paid: 0, pending: 0, due: 0 },
      });
    }

    // ── Search ──
    const search = req.query.search?.trim() || "";

    // ── Filter: ALL | PAID | PENDING ──
    const filter = req.query.filter || "ALL";

    // ── Build WHERE ──
    const where = { flat_id: { [Op.in]: myFlatIds } };

    if (filter === "PAID") {
      where.status = "PAID";
    } else if (filter === "PENDING") {
      where.status = { [Op.ne]: "PAID" };
    }

    if (search) {
      where[Op.or] = [
        { title:           { [Op.like]: `%${search}%` } },
        { billing_month:   { [Op.like]: `%${search}%` } },
        { other_bill_type: { [Op.like]: `%${search}%` } },
        { bill_category:   { [Op.like]: `%${search}%` } },
      ];
    }

    // ── Main paginated query ──
    const { count, rows: bills } = await Bill.findAndCountAll({
      where,
      include: [
        {
          model:      Flat,
          attributes: ["id", "flat_number"],
          include: [
            {
              model:      Block,
              attributes: ["id", "name"],
              include:    [{ model: Society, attributes: ["id", "name"] }],
            },
          ],
        },
      ],
      order:  [["created_at", "DESC"]],
      limit,
      offset,
    });

    // ── Tab counts ──
    const [totalAll, totalPaid, totalPending, totalPendingVerification] = await Promise.all([
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds } } }),
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds }, status: "PAID" } }),
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds }, status: "PENDING" } }),
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds }, status: "PENDING_VERIFICATION" } }),
    ]);

    // ── Due amount (only unpaid PENDING bills total, excluding PENDING_VERIFICATION) ──
    const pendingUnpaidBills = await Bill.findAll({
      where:      { flat_id: { [Op.in]: myFlatIds }, status: "PENDING" },
      attributes: ["amount"],
    });
    const totalDue = pendingUnpaidBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);

    res.status(200).json({
      data: bills,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        total:               totalAll,
        paid:                totalPaid,
        pending:             totalPending,
        pendingVerification: totalPendingVerification,
        due:                 totalDue,
      },
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* =====
   DELETE BILL
===== */
const deleteBill = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await Bill.findByPk(id);

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // Remove only unconfirmed payment attempts. SUCCESS payments are permanent
    // financial history and are intentionally preserved.
    await Payment.destroy({ where: { bill_id: id, status: { [Op.in]: ["PENDING", "FAILED"] } } });

    await bill.destroy();

    res.json({ message: "Bill deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* =====
   HELPER: PROCESS SINGLE BILL PAYMENT CONFIRMATION & NOTIFY
   Transactional: Payment => SUCCESS, Bill => PAID, Ledger => CREDIT.
   Never leaves Bill=PAID without a SUCCESS Payment and a Ledger CREDIT.
===== */
const processConfirmSingleBill = async (bill, reqUser, targetSocietyId) => {
  const t = await sequelize.transaction();
  let confirmed = false;
  try {
    // Lock the bill row so concurrent confirms cannot double-process.
    const locked = await Bill.findByPk(bill.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      include: [
        { model: Flat, include: [{ model: Block }] },
      ],
    });
    if (!locked) throw new Error("Bill not found");

    const alreadyPaid = locked.status === "PAID";
    if (!alreadyPaid) {
      const societyId =
        targetSocietyId || reqUser?.society_id || locked.Flat?.Block?.society_id || locked.Flat?.society_id;
      const residentId = locked.Flat?.resident_id || undefined;
      const source = locked.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";

      // 1. Mark the Payment as SUCCESS (create if missing for full audit).
      const payment = await Payment.findOne({ where: { bill_id: locked.id }, transaction: t });
      if (payment) {
        await payment.update(
          { status: "SUCCESS", society_id: societyId, resident_id: residentId, source },
          { transaction: t }
        );
      } else {
        await Payment.create({
          bill_id: locked.id,
          society_id: societyId,
          resident_id: residentId,
          amount: locked.amount,
          payment_mode: "UPI",
          source,
          status: "SUCCESS",
        }, { transaction: t });
      }

      // 2. Mark bill as PAID
      await locked.update({ status: "PAID" }, { transaction: t });

      // 3. Post a single Ledger CREDIT (idempotent via unique DB key).
      await createLedgerEntry({
        societyId,
        type: "CREDIT",
        source,
        referenceId: locked.id,
        amount: locked.amount,
        entryDate: new Date().toISOString().slice(0, 10),
        description: source === "MAINTENANCE" ? `Maintenance payment confirmed (${locked.title})` : `Bill payment confirmed (${locked.title})`,
        actor: reqUser,
        transaction: t,
      });

      confirmed = true;
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  if (confirmed) {
    // Notifications are non-critical and run after commit.
    await notifyBillConfirmation(bill, reqUser, targetSocietyId);
  }
};

const notifyBillConfirmation = async (bill, reqUser, targetSocietyId) => {
  // Find resident & household admins to notify (Web + Mobile Push)
  const userIdsToNotify = new Set();
  if (bill.resident_id) userIdsToNotify.add(bill.resident_id);
  if (bill.Flat?.resident_id) userIdsToNotify.add(bill.Flat.resident_id);

  const adminMembers = await HouseHoldMember.findAll({
    where: { flat_id: bill.flat_id, isAdmin: true },
  });
  for (let member of adminMembers) {
    if (member.user_id) userIdsToNotify.add(member.user_id);
  }

  if (userIdsToNotify.size > 0) {
    const usersToNotify = await User.findAll({
      where: { id: { [Op.in]: Array.from(userIdsToNotify) } },
      attributes: ["id", "fcm_token"],
    });

    const societyId = targetSocietyId || reqUser?.society_id || bill.Flat?.Block?.society_id || bill.Flat?.society_id;

    for (const user of usersToNotify) {
      const settings = await UserSetting.findOne({ where: { user_id: user.id } });
      if (!settings || settings.payment_updates !== false) {
        const notification = await Notification.create({
          title: "Bill Payment Confirmed",
          message: `✅ Your payment of ₹${bill.amount} for "${bill.title}" has been confirmed by Admin.`,
          type: "BILL",
          action_type: "BILL_CONFIRMED",
          action_route: "/resident/bills",
          society_id: societyId,
          receiver_user_id: user.id,
        });

        // 1. Web Socket real-time notification
        if (global.io) {
          global.io.to(`user_${user.id}`).emit("new_notification", notification);
        }

        // 2. Mobile FCM Push notification
        if (user.fcm_token) {
          sendPushNotification(
            user.fcm_token,
            "✅ Payment Confirmed",
            `Your payment of ₹${bill.amount} for ${bill.title} was confirmed by Admin.`,
            { route: "/resident/bills", billId: bill.id.toString(), status: "PAID" }
          ).catch((err) => console.error("[confirmPayment] Push Error:", err.message));
        }
      }
    }
  }
};

/* =====
   CONFIRM BILL PAYMENT (ADMIN / ACCOUNTANT / COMMITTEE)
===== */
const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await Bill.findByPk(id, {
      include: [
        {
          model: Flat,
          include: [{ model: Block }],
        },
      ],
    });

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    if (bill.status === "PAID") {
      return res.status(400).json({ success: false, message: "Bill is already marked as PAID" });
    }

    if (bill.status !== "PENDING_VERIFICATION") {
      return res.status(400).json({
        success: false,
        message: "Cannot confirm payment. The resident has not submitted payment for this bill yet.",
      });
    }

    const targetSocietyId = req.headers["x-society-id"] || req.user.society_id;
    await processConfirmSingleBill(bill, req.user, targetSocietyId);

    return res.status(200).json({
      success: true,
      message: "Payment confirmed successfully and notification sent to resident.",
      bill,
    });
  } catch (err) {
    console.error("Confirm Payment Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* =====
   BULK CONFIRM / APPROVE BILL PAYMENTS (ADMIN / ACCOUNTANT / COMMITTEE)
===== */
const bulkConfirmPayment = async (req, res) => {
  try {
    const rawIds = req.body.ids || req.body.bill_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ success: false, message: "A non-empty array of bill IDs is required." });
    }

    const ids = rawIds.map((id) => Number(id)).filter((id) => !isNaN(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "No valid bill IDs provided." });
    }

    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];
    const targetSocietyId = req.headers["x-society-id"] || req.user.society_id;

    const blockInclude = {
      model: Block,
      required: true,
      attributes: ["id", "name", "society_id"],
    };
    if (!isGlobalSuperAdmin && targetSocietyId) {
      blockInclude.where = { society_id: targetSocietyId };
    }

    const bills = await Bill.findAll({
      where: { id: { [Op.in]: ids } },
      include: [
        {
          model: Flat,
          required: true,
          attributes: ["id", "flat_number", "resident_id"],
          include: [blockInclude],
        },
      ],
    });

    if (bills.length === 0) {
      return res.status(404).json({ success: false, message: "No matching bills found." });
    }

    let approvedCount = 0;
    let skippedCount = 0;

    for (const bill of bills) {
      if (bill.status === "PAID") {
        skippedCount++;
        continue;
      }
      await processConfirmSingleBill(bill, req.user, targetSocietyId);
      approvedCount++;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${approvedCount} bill(s).${skippedCount > 0 ? ` (${skippedCount} already paid bill(s) were skipped)` : ""}`,
      approvedCount,
      skippedCount,
      totalRequested: ids.length,
    });
  } catch (err) {
    console.error("Bulk Confirm Payment Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* =====
   BULK DELETE BILLS (ADMIN / ACCOUNTANT / COMMITTEE)
===== */
const bulkDeleteBills = async (req, res) => {
  try {
    const rawIds = req.body.ids || req.body.bill_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ success: false, message: "A non-empty array of bill IDs is required." });
    }

    const ids = rawIds.map((id) => Number(id)).filter((id) => !isNaN(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "No valid bill IDs provided." });
    }

    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];
    const targetSocietyId = req.headers["x-society-id"] || req.user.society_id;

    const blockInclude = {
      model: Block,
      required: true,
      attributes: ["id", "name", "society_id"],
    };
    if (!isGlobalSuperAdmin && targetSocietyId) {
      blockInclude.where = { society_id: targetSocietyId };
    }

    const bills = await Bill.findAll({
      where: { id: { [Op.in]: ids } },
      include: [
        {
          model: Flat,
          required: true,
          attributes: ["id", "flat_number"],
          include: [blockInclude],
        },
      ],
    });

    if (bills.length === 0) {
      return res.status(404).json({ success: false, message: "No matching bills found." });
    }

    const targetIds = bills.map((b) => b.id);

    // Remove only unconfirmed payment attempts. SUCCESS payments are permanent
    // financial history and are intentionally preserved.
    await Payment.destroy({
      where: {
        bill_id: { [Op.in]: targetIds },
        status: { [Op.in]: ["PENDING", "FAILED"] },
      },
    });

    await Bill.destroy({
      where: { id: { [Op.in]: targetIds } },
    });

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${targetIds.length} bill(s).`,
      deletedCount: targetIds.length,
      totalRequested: ids.length,
    });
  } catch (err) {
    console.error("Bulk Delete Bills Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createBill,
  getSocietyBills,
  getResidentBills,
  confirmPayment,
  deleteBill,
  bulkConfirmPayment,
  bulkDeleteBills,
};