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
    if (filter === "PAID")    billWhere.status = "PAID";
    if (filter === "PENDING") billWhere.status = { [Op.ne]: "PAID" };

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

    const totalAll     = allBillsForCounts.length;
    const totalPaid    = allBillsForCounts.filter(b => b.status === "PAID").length;
    const totalPending = allBillsForCounts.filter(b => b.status !== "PAID").length;
    const totalRevenue = allBillsForCounts
      .filter(b => b.status === "PAID")
      .reduce((s, b) => s + Number(b.amount), 0);

    res.status(200).json({
      data: bills,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        total:   totalAll,
        paid:    totalPaid,
        pending: totalPending,
        revenue: totalRevenue,
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
    const [totalAll, totalPaid, totalPending] = await Promise.all([
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds } } }),
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds }, status: "PAID" } }),
      Bill.count({ where: { flat_id: { [Op.in]: myFlatIds }, status: { [Op.ne]: "PAID" } } }),
    ]);

    // ── Due amount (pending bills total, for stat card) ──
    const pendingBills = await Bill.findAll({
      where:      { flat_id: { [Op.in]: myFlatIds }, status: { [Op.ne]: "PAID" } },
      attributes: ["amount"],
    });
    const totalDue = pendingBills.reduce((sum, b) => sum + Number(b.amount), 0);

    res.status(200).json({
      data: bills,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        total:   totalAll,
        paid:    totalPaid,
        pending: totalPending,
        due:     totalDue,
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


module.exports = {
  createBill,
  getSocietyBills,
  getResidentBills,
  deleteBill,
};