const { User, Block, HouseHoldMember, Society } = require("../models");

const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Notification = require("../models/Notification");
const UserSetting = require("../models/UserSetting");
const { sendPushNotification } = require("../utils/pushNotification");

const { Op } = require("sequelize");

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

/* =====
   CREATE BILL
===== */
const createBill = async (req, res) => {
  try {
    const { flat_id, title, amount, billing_month, bill_type } = req.body;

    /* ==== INDIVIDUAL BILL ==== */
    if (bill_type === "INDIVIDUAL") {

      const flat = await Flat.findByPk(flat_id);

      if (!flat?.resident_id) {
        return res.status(400).json({
          message: "Cannot create bill. No resident assigned to this flat.",
        });
      }

      // Block billing for tenant-occupied flats
      if (flat.occupancy_status === "RENTED") {
        return res.status(400).json({
          message: "Cannot create bill for a tenant-occupied flat. Only owner-occupied flats are billed.",
        });
      }

      const bill = await Bill.create({
        flat_id,
        resident_id: flat.resident_id,
        title,
        amount,
        billing_month,
        due_date: addDays(30),
      });

      const userIdsToNotify = new Set();
      if (flat.resident_id) userIdsToNotify.add(flat.resident_id);

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
    if (bill_type === "ALL") {

      // Only bill owner-occupied flats — exclude RENTED (tenant) flats
      const flats = await Flat.findAll({
        where: {
          resident_id:      { [Op.ne]: null },
          occupancy_status: { [Op.in]: ["OWNER_OCCUPIED"] },
        },
        include: {
          model: Block,
          where: { society_id: req.user.society_id },
          attributes: [],
        },
      });

      const createdBills = [];

      for (let flat of flats) {
        const bill = await Bill.create({
          flat_id: flat.id,
          resident_id: flat.resident_id,
          title,
          amount,
          billing_month,
          due_date: addDays(30),
        });

        createdBills.push(bill);

        const user = await User.findByPk(flat.resident_id, { attributes: ["id", "fcm_token"] });
        const settings = await UserSetting.findOne({ where: { user_id: flat.resident_id } });

        if (!settings || settings.payment_updates !== false) {
          const notification = await Notification.create({
            title: "Bill Payment Pending",
            message: `⚡ Your ${title} bill of ₹${amount} is waiting for payment`,
            type: "BILL",
            action_type: "BILL_PAYMENT",
            action_route: "/resident/bills",
            society_id: req.user.society_id,
            receiver_role: "RESIDENT",
            receiver_user_id: flat.resident_id,
          });

          if (global.io) {
            global.io.to(`user_${flat.resident_id}`).emit("new_notification", notification);
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

    // ── Society scope via Block join ──
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];

    const blockInclude = {
      model:      Block,
      required:   true,
      attributes: ["id", "name"],
      include:    [{ model: Society, attributes: ["id", "name"] }],
    };
    if (!isGlobalSuperAdmin) {
      blockInclude.where = { society_id: req.user.society_id };
    }

    // ── Status WHERE ──
    const billWhere = {};
    if (filter === "PAID") billWhere.status = "PAID";
    else if (filter === "PENDING") billWhere.status = "PENDING";
    else if (filter === "PENDING_VERIFICATION") billWhere.status = "PENDING_VERIFICATION";

    // ── Search: title or billing_month ──
    if (search) {
      billWhere[Op.or] = [
        { title:         { [Op.like]: `%${search}%` } },
        { billing_month: { [Op.like]: `%${search}%` } },
      ];
    }

    // ── Base include (always scoped to society) ──
    const flatInclude = {
      model:      Flat,
      required:   true,
      attributes: ["id", "flat_number"],
      include: [
        blockInclude,
        { model: User, attributes: ["id", "name"] },
      ],
    };

    // ── Paginated query ──
    const { count, rows: bills } = await Bill.findAndCountAll({
      where:    billWhere,
      include:  [flatInclude],
      order:    [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    // ── Unfiltered counts for stat strip & tab badges ──
    const countBlockInclude = { model: Block, required: true, attributes: [] };
    if (!isGlobalSuperAdmin) {
      countBlockInclude.where = { society_id: req.user.society_id };
    }

    const allBillsForCounts = await Bill.findAll({
      attributes: ["id", "status", "amount"],
      include: [{
        model:    Flat,
        required: true,
        attributes: [],
        include:  [countBlockInclude],
      }],
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
        { title:         { [Op.like]: `%${search}%` } },
        { billing_month: { [Op.like]: `%${search}%` } },
      ];
    }

    // ── Main paginated query ──
    const { count, rows: bills } = await Bill.findAndCountAll({
      where,
      include: [
        {
          model:      Flat,
          attributes: ["id", "flat_number"],
          include:    [{ model: Block, attributes: ["id", "name"] }],
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

    if (bill.status === "PAID") {
      return res.status(400).json({ message: "Paid bills cannot be deleted" });
    }

    await bill.destroy();

    res.json({ message: "Bill deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* =====
   CONFIRM BILL PAYMENT (ADMIN / ACCOUNTANT / COMMITTEE)
===== */
const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await Bill.findByPk(id, {
      include: [{ model: Flat }],
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

    // Update Bill status to PAID
    await bill.update({ status: "PAID" });

    // Update Payment record if exists
    const Payment = require("../models/Payment");
    const payment = await Payment.findOne({ where: { bill_id: bill.id } });
    if (payment) {
      await payment.update({ status: "SUCCESS" });
    }

    // Find resident to notify (Web + Mobile Push)
    const userIdsToNotify = new Set();
    if (bill.resident_id) userIdsToNotify.add(bill.resident_id);
    if (bill.Flat?.resident_id) userIdsToNotify.add(bill.Flat.resident_id);

    const adminMembers = await HouseHoldMember.findAll({
      where: { flat_id: bill.flat_id, isAdmin: true },
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
          title: "Bill Payment Confirmed",
          message: `✅ Your payment of ₹${bill.amount} for "${bill.title}" has been confirmed by Admin.`,
          type: "BILL",
          action_type: "BILL_CONFIRMED",
          action_route: "/resident/bills",
          society_id: req.user.society_id || bill.Flat?.society_id,
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


module.exports = {
  createBill,
  getSocietyBills,
  getResidentBills,
  confirmPayment,
  deleteBill,
};