const { Bill, Flat, User, Block, Payment, Society, AmenityBooking, Amenity, FlatMembership, sequelize } = require("../models");
const { Op } = require("sequelize");

const getSocietyBills = async (req, res) => {
  try {
    const bills = await Bill.findAll({
      include: {
        model: Flat,
        required: true,
        attributes: ["id", "flat_number"],
        include: [
          {
            model: Block,
            required: true,
            attributes: ["id", "name"],
            where: { society_id: req.user.society_id },
          },
          {
            model: FlatMembership,
            required: false,
            where: { is_current: true },
            include: [{ model: User, required: false, attributes: ["id", "name"] }],
          },
        ],
      },
      order: [["created_at", "DESC"]],
    });

    const formatted = bills.map((bill) => {
      const b = bill.toJSON ? bill.toJSON() : bill;
      if (b.Flat) {
        const active = b.Flat.FlatMemberships?.find((m) => m.is_current) || b.Flat.FlatMemberships?.[0];
        b.Flat.User = active?.User || null;
      }
      return b;
    });

    res.status(200).json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getPayments = async (req, res) => {
  try {
    const pagesize = Math.min(100, parseInt(req.query.limit) || 50);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * pagesize;

    const where = { society_id: req.user.society_id };
    if (req.query.status) where.status = req.query.status.toUpperCase();
    if (req.query.source) where.source = req.query.source.toUpperCase();

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [
        {
          model: Bill,
          required: false,
          attributes: ["id", "title", "amount", "billing_month"],
          include: [
            {
              model: Flat,
              required: false,
              attributes: ["id", "flat_number"],
              include: [
                {
                  model: FlatMembership,
                  required: false,
                  where: { is_current: true },
                  include: [{ model: User, required: false, attributes: ["id", "name"] }],
                },
              ],
            },
          ],
        },
        {
          model: AmenityBooking,
          as: "booking",
          required: false,
          attributes: ["id", "amenity_id", "user_id", "date", "from_date", "to_date", "flat_id"],
          include: [
            { model: Amenity, attributes: ["name"], required: false },
            { model: Flat, attributes: ["id", "flat_number"], required: false },
            {
              model: User,
              attributes: ["id", "name"],
              required: false,
              include: [
                {
                  model: FlatMembership,
                  required: false,
                  include: [{ model: Flat, attributes: ["id", "flat_number"], required: false }],
                },
              ],
            },
          ],
        },
        {
          model: User,
          as: "resident",
          required: false,
          attributes: ["id", "name"],
          include: [
            {
              model: FlatMembership,
              required: false,
              include: [{ model: Flat, attributes: ["id", "flat_number"], required: false }],
            },
          ],
        },
      ],
      order: [["payment_date", "DESC"], ["id", "DESC"]],
      limit: pagesize,
      offset,
    });

    res.status(200).json({
      success: true,
      data: rows,
      pagination: { currentPage: page, totalPages: Math.ceil(count / pagesize), totalItems: count, limit: pagesize },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const monthlyCollection = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    const [rows] = await sequelize.query(
      `SELECT
         payment_mode,
         COALESCE(SUM(amount), 0) AS total,
         COUNT(*) AS transactions,
         COALESCE(AVG(amount), 0) AS average,
         MAX(payment_date) AS last_payment
       FROM ${Payment.getTableName()}
       WHERE society_id = ?
         AND status = 'SUCCESS'
         AND payment_date >= ?
         AND payment_date <= ?
       GROUP BY payment_mode`,
      {
        replacements: [
          societyId,
          new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999),
        ],
      }
    );

    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    const society = await Society.findByPk(societyId);
    const societyName = society ? society.name : null;

    const now = new Date();
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(now);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const billInclude = {
      model: Flat,
      required: true,
      attributes: [],
      include: {
        model: Block,
        required: true,
        attributes: [],
        where: { society_id: societyId },
      },
    };

    const [bills, paymentSums, ledgerSums, monthlyPayments] = await Promise.all([
      Bill.findAll({ attributes: ["id", "status", "amount"], include: billInclude }),
      sequelize.query(
        `SELECT
           COALESCE(SUM(CASE WHEN source = 'BILL' THEN amount ELSE 0 END), 0) AS bill_income,
           COALESCE(SUM(CASE WHEN source = 'MAINTENANCE' THEN amount ELSE 0 END), 0) AS maintenance_income,
           COALESCE(SUM(CASE WHEN source = 'AMENITY' THEN amount ELSE 0 END), 0) AS amenity_income,
           COALESCE(SUM(amount), 0) AS total_collected
         FROM ${Payment.getTableName()} WHERE society_id = ? AND status = 'SUCCESS'`,
        { replacements: [societyId], type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
           COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_debit,
           COALESCE(SUM(CASE WHEN type = 'DEBIT' AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS total_expenses
         FROM ledger_entries WHERE society_id = ?`,
        { replacements: [societyId], type: sequelize.QueryTypes.SELECT }
      ),
      Payment.findAll({
        attributes: ["amount"],
        where: {
          society_id: societyId,
          status: "SUCCESS",
          payment_date: { [Op.between]: [startOfMonth, endOfMonth] },
        },
      }),
    ]);

    const totalBills = bills.length;
    const paidBills = bills.filter((b) => b.status === "PAID");
    const pendingBills = bills.filter((b) => b.status !== "PAID");
    const awaitingConfirm = bills.filter((b) => b.status === "PENDING_VERIFICATION");

    const income = paymentSums[0] || {};
    const ledger = ledgerSums[0] || {};
    const openingBalance = Number(society?.opening_balance) || 0;
    const billIncome = Number(income.bill_income) || 0;
    const maintenanceIncome = Number(income.maintenance_income) || 0;
    const amenityIncome = Number(income.amenity_income) || 0;
    const totalCollected = Number(income.total_collected) || 0;
    const totalCredit = Number(ledger.total_credit) || 0;
    const totalDebit = Number(ledger.total_debit) || 0;
    const totalExpenses = Number(ledger.total_expenses) || 0;
    const totalDue = pendingBills.reduce((s, b) => s + Number(b.amount || 0), 0);
    const paidRate = totalBills ? Math.round((paidBills.length / totalBills) * 100) : 0;

    return res.json({
      societyName: societyName || req.user.society_name || null,
      totalBills,
      paidBills: paidBills.length,
      pendingBills: pendingBills.length,
      awaitingConfirm: awaitingConfirm.length,
      totalDue,
      paidRate,
      // Money IN (realised payments incl. amenity/maintenance)
      totalCollected,
      totalCollectedAll: totalCollected,
      billIncome,
      maintenanceIncome,
      amenityIncome,
      monthlyCollected: monthlyPayments.reduce((s, p) => s + Number(p.amount || 0), 0),
      monthlyTransactions: monthlyPayments.length,
      // Money OUT / net position (ledger based, amenity aware)
      totalExpenses,
      openingBalance,
      currentBalance: Math.round((openingBalance + totalCredit - totalDebit) * 100) / 100,
    });
  } catch (err) {
    console.error("Accountant dashboard stats error:", err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getSocietyBills, getPayments, monthlyCollection, getDashboardStats };