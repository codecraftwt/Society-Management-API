const { Bill, Flat, User, Block, Payment, Society, AmenityBooking, Amenity, FlatMembership, SocietyFinancialAccount, sequelize } = require("../models");
const { Op } = require("sequelize");
const { createLedgerEntry, ensureCashAccount, getDefaultBankAccount } = require("../utils/ledgerService");
const { formatAccount } = require("./financialAccountControllers");
const { processConfirmSingleBill } = require("./billControllers");

const getSocietyBills = async (req, res) => {
  try {
    const bills = await Bill.findAll({
      include: {
        model: Flat,
        required: true,
        attributes: ["id", "flat_number", "resident_id"],
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
          {
            // Directly-assigned resident fallback (legacy resident_id).
            model: User,
            required: false,
            attributes: ["id", "name"],
          },
        ],
      },
      order: [["created_at", "DESC"]],
    });

    const formatted = bills.map((bill) => {
      const b = bill.toJSON ? bill.toJSON() : bill;
      if (b.Flat) {
        const active = b.Flat.FlatMemberships?.find((m) => m.is_current) || b.Flat.FlatMemberships?.[0];
        b.Flat.User = active?.User || b.Flat.User || null;
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

    const societyId = req.user.activeRole === "SUPER_ADMIN"
      ? parseInt(req.headers["x-society-id"] || req.query.society_id, 10) || req.user.society_id
      : req.user.society_id;

    const where = { society_id: societyId };
    if (req.query.status) where.status = req.query.status.toUpperCase();
    else where.status = { [Op.ne]: "INITIATED" };
    if (req.query.source) where.source = req.query.source.toUpperCase();
    if (req.query.financial_account_id && req.query.financial_account_id !== "ALL") {
      const upper = String(req.query.financial_account_id).toUpperCase();
      if (upper === "CASH") {
        const cashAcc = await ensureCashAccount(societyId);
        if (cashAcc) where.financial_account_id = cashAcc.id;
      } else if (upper === "LEGACY") {
        where.financial_account_id = null;
      } else {
        const accId = parseInt(req.query.financial_account_id, 10);
        if (Number.isInteger(accId) && accId > 0) where.financial_account_id = accId;
      }
    }

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [
        {
          model: SocietyFinancialAccount,
          as: "financialAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number"],
        },
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

    const formattedRows = rows.map((r) => {
      const j = r.toJSON ? r.toJSON() : { ...r };
      if (j.financialAccount) j.financialAccount = formatAccount(j.financialAccount);
      return j;
    });

    res.status(200).json({
      success: true,
      data: formattedRows,
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

const confirmPaymentRecord = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const payment = await Payment.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!payment) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Payment record not found." });
    }
    const societyId = req.user.activeRole === "SUPER_ADMIN"
      ? parseInt(req.headers["x-society-id"] || req.query.society_id, 10) || payment.society_id
      : req.user.society_id;
    if (Number(payment.society_id) !== Number(societyId)) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Not authorized for this society's payment." });
    }
    if (payment.status === "SUCCESS") {
      await t.commit();
      return res.json({ success: true, alreadyProcessed: true, message: "Payment already confirmed." });
    }
    if (payment.status !== "PENDING") {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Cannot confirm payment in status ${payment.status}.` });
    }

    if (payment.bill_id) {
      await t.rollback();
      const bill = await Bill.findByPk(payment.bill_id, {
        include: [{ model: Flat, include: [{ model: Block }] }],
      });
      if (!bill) return res.status(404).json({ success: false, message: "Associated bill not found." });
      await processConfirmSingleBill(bill, req.user, societyId, {
        payment_mode: req.body?.payment_mode,
        financial_account_id: req.body?.financial_account_id,
      });
      return res.json({ success: true, message: "Bill payment confirmed." });
    }

    if (payment.amenity_booking_id) {
      const booking = await AmenityBooking.findByPk(payment.amenity_booking_id, {
        include: [{ model: Amenity, attributes: ["id", "name", "requires_approval"] }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!booking) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Associated amenity booking not found." });
      }
      const resolvedMode = req.body?.payment_mode ? String(req.body.payment_mode).toUpperCase() : payment.payment_mode || "RAZORPAY";
      let resolvedAccId = payment.financial_account_id || booking.financial_account_id || null;
      if (resolvedMode === "CASH") {
        const cash = await ensureCashAccount(societyId, t);
        resolvedAccId = cash?.id || null;
      } else if (req.body?.financial_account_id) {
        resolvedAccId = parseInt(req.body.financial_account_id, 10);
      } else if (!resolvedAccId) {
        const defBank = await getDefaultBankAccount(societyId, t);
        resolvedAccId = defBank?.id || null;
      }

      await payment.update(
        {
          status: "SUCCESS",
          payment_mode: resolvedMode,
          financial_account_id: resolvedAccId,
          confirmed_by: req.user.id,
          confirmed_at: new Date(),
        },
        { transaction: t }
      );
      await booking.update(
        {
          payment_status: "PAID",
          status: booking.Amenity?.requires_approval ? "PENDING" : "APPROVED",
          financial_account_id: resolvedAccId,
        },
        { transaction: t }
      );
      await createLedgerEntry({
        societyId,
        type: "CREDIT",
        source: "AMENITY",
        referenceId: booking.id,
        amount: payment.amount,
        entryDate: booking.from_date || booking.date || new Date().toISOString().slice(0, 10),
        description: `Amenity booking (${booking.Amenity?.name || "Amenity"}) payment confirmed`,
        financialAccountId: resolvedAccId,
        actor: req.user,
        transaction: t,
      });
      await t.commit();
      return res.json({ success: true, message: "Amenity payment confirmed." });
    }

    await t.rollback();
    return res.status(400).json({ success: false, message: "Unsupported payment record." });
  } catch (err) {
    await t.rollback();
    console.error("[confirmPaymentRecord]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSocietyBills, getPayments, monthlyCollection, getDashboardStats, confirmPaymentRecord };