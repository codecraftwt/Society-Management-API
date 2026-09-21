const { Op } = require("sequelize");
const {
  sequelize,
  Society,
  Expense,
  LedgerEntry,
  FinancialAuditLog,
  Bill,
  Flat,
  User,
  AmenityBooking,
  Amenity,
} = require("../models");
const { createLedgerEntry, reverseLedgerEntry, auditLog, resolveActorRole } = require("../utils/ledgerService");

/* ──  User identity enrichment ─────────────────────────────────────────────
   Expenses store only created_by (user id). Ledger entries and audit logs
   store created_by / performed_by. This helper batch-loads the users so every
   finance read responds with the person's name + normalized role instead of a
   bare id or "System". */
async function enrichWithActors(rows, idField, nameField, roleField, includeRoles = true) {
  const ids = [...new Set(rows.map((r) => r[idField]).filter(Boolean))];
  const map = new Map();
  if (ids.length > 0) {
    const users = await User.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: includeRoles ? ["id", "name", "role", "roles"] : ["id", "name"],
    });
    users.forEach((u) => {
      const actor = { activeRole: u.role, role: u.role, roles: u.roles || [] };
      map.set(u.id, { name: u.name, role: resolveActorRole(actor) });
    });
  }
  return rows.map((r) => {
    const j = r.toJSON ? r.toJSON() : r;
    const info = map.get(j[idField]);
    if (info) {
      j[nameField] = info.name;
      if (roleField) j[roleField] = info.role;
    }
    return j;
  });
}

/* ──  Society resolution helper ────────────────────────────────────────────
   Non-Super-Admins are always scoped to their own society. Super Admin may
   target any society via the x-society-id header (global context) or the
   ?society_id query param. */
function resolveSocietyId(req) {
  if (req.user.activeRole === "SUPER_ADMIN") {
    return parseInt(req.headers["x-society-id"] || req.query.society_id, 10) || req.user.society_id;
  }
  return req.user.society_id;
}

async function getSocietyMeta(societyId) {
  if (!societyId) return null;
  return Society.findByPk(societyId, { attributes: ["id", "name", "address", "opening_balance", "opening_balance_effective_date", "opening_balance_set_at"] });
}

/* ══════════════════════════════════════════════════════════════════════════
   GET SOCIETY BALANCE  (computed from ledger, never stored)
   GET /api/account/balance
══════════════════════════════════════════════════════════════════════════ */
const getBalance = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const society = await getSocietyMeta(societyId);
    if (!society) return res.status(404).json({ success: false, message: "Society not found." });

    const [sums] = await sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
         COALESCE(SUM(CASE WHEN type = 'DEBIT'  THEN amount ELSE 0 END), 0) AS total_debit,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source IN ('BILL','MAINTENANCE','AMENITY') THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'BILL' THEN amount ELSE 0 END), 0) AS bill_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'MAINTENANCE' THEN amount ELSE 0 END), 0) AS maintenance_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'AMENITY' THEN amount ELSE 0 END), 0) AS amenity_income,
         COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS total_expenses,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS void_reversals
       FROM ledger_entries
       WHERE society_id = ?`,
      { replacements: [societyId] }
    );

    const opening = Number(society.opening_balance) || 0;
    const totalCredit = Number(sums[0].total_credit) || 0;
    const totalDebit = Number(sums[0].total_debit) || 0;
    const currentBalance = opening + totalCredit - totalDebit;

    return res.json({
      success: true,
      data: {
        society_id: society.id,
        society_name: society.name,
        opening_balance: opening,
        opening_balance_effective_date: society.opening_balance_effective_date,
        opening_balance_set_at: society.opening_balance_set_at,
        total_credit: totalCredit,
        total_debit: totalDebit,
        total_income: Number(sums[0].total_income) || 0,
        bill_income: Number(sums[0].bill_income) || 0,
        maintenance_income: Number(sums[0].maintenance_income) || 0,
        amenity_income: Number(sums[0].amenity_income) || 0,
        total_expenses: Number(sums[0].total_expenses) || 0,
        void_reversals: Number(sums[0].void_reversals) || 0,
        current_balance: currentBalance,
      },
    });
  } catch (error) {
    console.error("[getBalance]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   GET LEDGER  (paginated, running balance, virtual OPENING row on page 1)
   GET /api/account/ledger?page=1&limit=20&type=CREDIT&source=BILL&from=&to=
══════════════════════════════════════════════════════════════════════════ */
const getLedger = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = { society_id: societyId };
    if (req.query.type && ["CREDIT", "DEBIT"].includes(req.query.type.toUpperCase())) {
      where.type = req.query.type.toUpperCase();
    }
    if (req.query.source && ["BILL", "MAINTENANCE", "AMENITY", "EXPENSE", "ADJUSTMENT"].includes(req.query.source.toUpperCase())) {
      where.source = req.query.source.toUpperCase();
    }
    if (req.query.search && req.query.search.trim()) {
      where.description = { [Op.like]: `%${req.query.search.trim()}%` };
    }
    if (req.query.from && req.query.to) {
      where.entry_date = { [Op.between]: [req.query.from, req.query.to] };
    } else if (req.query.from) {
      where.entry_date = { [Op.gte]: req.query.from };
    } else if (req.query.to) {
      where.entry_date = { [Op.lte]: req.query.to };
    }

    const { count, rows } = await LedgerEntry.findAndCountAll({
      where,
      order: [["entry_date", "ASC"], ["id", "ASC"]],
      limit,
      offset,
    });

    // ── Enrich rows with the financial unit each entry refers to so the UI
    //    can show "who paid" (CREDIT) / "paid to & by" (DEBIT) in the details
    //    modal. reference_id is polymorphic per source:
    //      BILL/MAINTENANCE → bills.id   AMENITY → amenity_bookings.id
    //      EXPENSE          → expenses.id
    const intake = {};
    for (const r of rows) {
      const type = r.source === "ADJUSTMENT" ? "ADJUSTMENT" : r.source;
      if (!r.reference_id || type === "ADJUSTMENT" || type === "OPENING") continue;
      (intake[type] ||= []).push(r.reference_id);
    }
    const uniq = (arr = []) => [...new Set(arr)];

    const billRows = intake.BILL?.length || intake.MAINTENANCE?.length
      ? await Bill.findAll({
          where: { id: { [Op.in]: uniq([...(intake.BILL || []), ...(intake.MAINTENANCE || [])]) } },
          attributes: ["id", "title", "type", "billing_month", "issue_date", "due_date"],
          include: [
            {
              model: Flat,
              required: false,
              attributes: ["id", "flat_number"],
              include: [{ model: User, required: false, attributes: ["id", "name"] }],
            },
          ],
        })
      : [];
    const billDetailById = new Map(billRows.map((b) => [b.id, {
      title: b.title,
      bill_type: b.type,
      billing_month: b.billing_month,
      issue_date: b.issue_date ? b.issue_date.toISOString().slice(0, 10) : null,
      due_date: b.due_date ? b.due_date.toISOString().slice(0, 10) : null,
      payer_name: b.Flat?.User?.name || null,
      flat_number: b.Flat?.flat_number || null,
    }]));

    const amenityRows = intake.AMENITY?.length
      ? await AmenityBooking.findAll({
          where: { id: { [Op.in]: uniq(intake.AMENITY) } },
          attributes: ["id", "date", "start_time"],
          include: [
            { model: User, required: false, attributes: ["id", "name"] },
            { model: Amenity, required: false, attributes: ["id", "name"] },
          ],
        })
      : [];
    const amenityDetailById = new Map(amenityRows.map((b) => [b.id, {
      amenity_name: b.Amenity?.name || null,
      booked_date: b.date || null,
      booker_name: b.User?.name || null,
      booker_id: b.User?.id || null,
    }]));

    const expenseRows = intake.EXPENSE?.length
      ? await Expense.findAll({
          where: { id: { [Op.in]: uniq(intake.EXPENSE) } },
          attributes: ["id", "pay_to", "reason", "amount", "payment_date", "payment_mode", "paid_by", "status"],
        })
      : [];
    const expenseDetailById = new Map(expenseRows.map((e) => [e.id, {
      pay_to: e.pay_to,
      reason: e.reason,
      payment_date: e.payment_date || null,
      payment_mode: e.payment_mode,
      paid_by: e.paid_by,
      status: e.status,
    }]));

    const resolveDetail = (r) => {
      if (!r.reference_id) return null;
      if (r.source === "BILL" || r.source === "MAINTENANCE") return billDetailById.get(r.reference_id) || null;
      if (r.source === "AMENITY") return amenityDetailById.get(r.reference_id) || null;
      if (r.source === "EXPENSE") return expenseDetailById.get(r.reference_id) || null;
      return null;
    };

    const society = await getSocietyMeta(societyId);
    const opening = Number(society?.opening_balance) || 0;

    let runningBalance = opening;
    if (offset > 0 && rows.length > 0) {
      const boundary = { entry_date: rows[0].entry_date, id: rows[0].id };
      const [before] = await sequelize.query(
        `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS bal
           FROM ledger_entries
           WHERE society_id = ?
             AND (entry_date < :d OR (entry_date = :d AND id < :i))`,
        { replacements: { ...boundary, ...{ society_id: societyId } } }
      );
      runningBalance += Number(before[0].bal) || 0;
    }

    const entries = rows.map((r) => {
      runningBalance += r.type === "CREDIT" ? Number(r.amount) : -Number(r.amount);
      return { ...r.toJSON(), running_balance: Math.round(runningBalance * 100) / 100, detail: resolveDetail(r) };
    });

    // Virtual OPENING row on the first page only when filters allow opening credit entries
    const hasTypeFilter = Boolean(req.query.type && req.query.type.trim());
    const isCreditType = req.query.type?.toUpperCase() === "CREDIT";
    const hasSourceFilter = Boolean(req.query.source && req.query.source.trim());
    const isOpeningSource = req.query.source?.toUpperCase() === "OPENING";
    const hasSearch = Boolean(req.query.search && req.query.search.trim());

    const allowsOpening =
      (!hasTypeFilter || isCreditType) &&
      (!hasSourceFilter || isOpeningSource) &&
      (!hasSearch || "opening balance (pre-tracking funds)".toLowerCase().includes(req.query.search.trim().toLowerCase())) &&
      (!req.query.from || (society?.opening_balance_effective_date && society.opening_balance_effective_date >= req.query.from)) &&
      (!req.query.to || (society?.opening_balance_effective_date && society.opening_balance_effective_date <= req.query.to));

    let dataEntries = entries;
    const includeOpeningRow = page === 1 && allowsOpening && opening > 0;
    if (includeOpeningRow) {
      dataEntries = [
        {
          id: null,
          type: "CREDIT",
          source: "OPENING",
          reference_id: null,
          amount: opening,
          entry_date: society?.opening_balance_effective_date || null,
          description: "Opening balance (pre-tracking funds)",
          status: "POSTED",
          created_at: society?.opening_balance_set_at || null,
          running_balance: opening,
          opening: true,
        },
        ...entries,
      ];
    }

    const totalCount = count + (allowsOpening && opening > 0 ? 1 : 0);

    return res.json({
      success: true,
      data: await enrichWithActors(dataEntries, "created_by", "created_by_name", "created_by_role"),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit) || 1,
        totalItems: totalCount,
        limit,
      },
      opening_balance: opening,
      society_name: society?.name || null,
    });
  } catch (error) {
    console.error("[getLedger]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   SET / ADJUST OPENING BALANCE  (locked after set; adjust = audited correction)
   PUT /api/account/opening-balance   { amount, effective_date, reason }
══════════════════════════════════════════════════════════════════════════ */
const setOpeningBalance = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const amount = Number(req.body.amount);
    const effectiveDate = req.body.effective_date || new Date().toISOString().slice(0, 10);
    const reason = (req.body.reason || "").toString().trim();

    if (!Number.isFinite(amount) || amount < 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Opening balance must be a non-negative number." });
    }
    if (!reason) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "A reason is required for the opening balance." });
    }

    const society = await Society.findByPk(societyId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!society) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    const previous = {
      opening_balance: society.opening_balance,
      effective_date: society.opening_balance_effective_date,
    };
    const isFirstSet = previous.opening_balance === 0 && previous.effective_date === null;

    await society.update({
      opening_balance: Math.round(amount * 100) / 100,
      opening_balance_effective_date: effectiveDate,
      opening_balance_set_by: req.user.id,
      opening_balance_set_at: new Date(),
    }, { transaction: t });

    await auditLog({
      societyId,
      action: isFirstSet ? "OPENING_BALANCE_SET" : "OPENING_BALANCE_ADJUST",
      entityType: "Society",
      entityId: societyId,
      oldValue: previous,
      newValue: { opening_balance: amount, effective_date: effectiveDate },
      reason,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({
      success: true,
      message: isFirstSet ? "Opening balance recorded." : "Opening balance adjusted (audited).",
      data: { society_id: societyId, opening_balance: amount, effective_date: effectiveDate },
    });
  } catch (error) {
    await t.rollback();
    console.error("[setOpeningBalance]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   LIST EXPENSES
   GET /api/expenses?page=&limit=&from=&to=&status=&search=&society_id=
══════════════════════════════════════════════════════════════════════════ */
const listExpenses = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = { society_id: societyId };
    if (req.query.status && ["POSTED", "VOID"].includes(req.query.status.toUpperCase())) {
      where.status = req.query.status.toUpperCase();
    }
    if (req.query.from && req.query.to) {
      where.payment_date = { [Op.between]: [req.query.from, req.query.to] };
    }
    if (req.query.search) {
      where[Op.or] = [
        { pay_to: { [Op.like]: `%${req.query.search}%` } },
        { reason: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    const { count, rows } = await Expense.findAndCountAll({
      where,
      order: [["payment_date", "DESC"], ["id", "DESC"]],
      limit,
      offset,
    });

    const [totals] = await sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'POSTED' THEN amount ELSE 0 END), 0) AS posted_total,
         COALESCE(SUM(amount), 0) AS grand_total,
         COUNT(*) AS total_count,
         COALESCE(SUM(CASE WHEN status = 'VOID' THEN 1 ELSE 0 END), 0) AS void_count
       FROM expenses WHERE society_id = ?`,
      { replacements: [societyId] }
    );

    return res.json({
      success: true,
      data: await enrichWithActors(rows, "created_by", "created_by_name", "created_by_role"),
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      totals: totals[0],
    });
  } catch (error) {
    console.error("[listExpenses]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   GET SINGLE EXPENSE
   GET /api/expenses/:id
══════════════════════════════════════════════════════════════════════════ */
const getExpense = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    const expense = await Expense.findOne({ where: { id: req.params.id, society_id: societyId } });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found." });
    const data = (await enrichWithActors([expense], "created_by", "created_by_name", "created_by_role"))[0];
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   CREATE EXPENSE  (money out → Ledger DEBIT)
   POST /api/expenses
══════════════════════════════════════════════════════════════════════════ */
const createExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const { pay_to, reason, amount, payment_date, payment_mode, receipt_url } = req.body;
    if (!pay_to || !reason || amount === undefined) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "pay_to, reason and amount are required." });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Amount must be a positive number." });
    }

    const VALID_PAID_BY = ["SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER", "SUPER_ADMIN"];
    const VALID_PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"];

    const rawPaidBy = (req.body.paid_by || req.user.activeRole || req.user.role || "SOCIETY_ADMIN").toUpperCase();
    const paidBy = VALID_PAID_BY.includes(rawPaidBy) ? rawPaidBy : "SOCIETY_ADMIN";
    const rawMode = (payment_mode || "CASH").toUpperCase();
    const resolvedPaymentMode = VALID_PAYMENT_MODES.includes(rawMode) ? rawMode : "CASH";

    const expense = await Expense.create({
      society_id: societyId,
      pay_to: pay_to.toString().trim(),
      reason: reason.toString().trim(),
      amount: amt,
      payment_date: payment_date || new Date().toISOString().slice(0, 10),
      paid_by: paidBy,
      payment_mode: resolvedPaymentMode,
      receipt_url: receipt_url || null,
      status: "POSTED",
      created_by: req.user.id,
    }, { transaction: t });

    await createLedgerEntry({
      societyId,
      type: "DEBIT",
      source: "EXPENSE",
      referenceId: expense.id,
      amount: amt,
      entryDate: expense.payment_date,
      description: `Expense: ${reason} (paid to ${pay_to})`,
      actor: req.user,
      transaction: t,
    });

    await auditLog({
      societyId,
      action: "EXPENSE_CREATE",
      entityType: "Expense",
      entityId: expense.id,
      newValue: expense.toJSON(),
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: expense, message: "Expense recorded." });
  } catch (error) {
    await t.rollback();
    console.error("[createExpense]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   UPDATE EXPENSE  (only while POSTED)
   PUT /api/expenses/:id
══════════════════════════════════════════════════════════════════════════ */
const updateExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const expense = await Expense.findOne({ where: { id: req.params.id, society_id: societyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!expense) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Expense not found." });
    }
    if (expense.status !== "POSTED") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Voided expenses cannot be edited." });
    }

    const oldValue = expense.toJSON();
    const updates = {};
    if (req.body.pay_to !== undefined) updates.pay_to = req.body.pay_to;
    if (req.body.reason !== undefined) updates.reason = req.body.reason;
    if (req.body.payment_mode !== undefined) {
      const mode = req.body.payment_mode.toUpperCase();
      updates.payment_mode = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"].includes(mode) ? mode : "CASH";
    }
    if (req.body.payment_date !== undefined) updates.payment_date = req.body.payment_date;
    if (req.body.receipt_url !== undefined) updates.receipt_url = req.body.receipt_url;
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Amount must be a positive number." });
      }
      updates.amount = amt;
    }

    await expense.update(updates, { transaction: t });

    // Keep the ledger DEBIT in sync with the edited amount.
    const debit = await LedgerEntry.findOne({
      where: { society_id: societyId, source: "EXPENSE", reference_id: expense.id, type: "DEBIT" },
      transaction: t,
    });
    if (debit && updates.amount) {
      await debit.update({ amount: updates.amount, description: `Expense: ${expense.reason} (paid to ${expense.pay_to})` }, { transaction: t });
    }

    await auditLog({
      societyId,
      action: "EXPENSE_UPDATE",
      entityType: "Expense",
      entityId: expense.id,
      oldValue,
      newValue: expense.toJSON(),
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: expense, message: "Expense updated." });
  } catch (error) {
    await t.rollback();
    console.error("[updateExpense]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   VOID EXPENSE  (soft delete + reversed ledger impact)
   DELETE /api/expenses/:id
══════════════════════════════════════════════════════════════════════════ */
const voidExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const expense = await Expense.findOne({ where: { id: req.params.id, society_id: societyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!expense) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Expense not found." });
    }
    if (expense.status === "VOID") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Expense is already voided." });
    }

    await expense.update({ status: "VOID" }, { transaction: t });

    const debit = await LedgerEntry.findOne({
      where: { society_id: societyId, source: "EXPENSE", reference_id: expense.id, type: "DEBIT" },
      transaction: t,
    });
    if (debit) {
      await reverseLedgerEntry({
        entry: debit,
        actor: req.user,
        reason: `Expense voided (${expense.reason})`,
        transaction: t,
      });
    }

    await auditLog({
      societyId,
      action: "EXPENSE_VOID",
      entityType: "Expense",
      entityId: expense.id,
      oldValue: { status: "POSTED" },
      newValue: { status: "VOID" },
      reason: req.body?.reason || null,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, message: "Expense voided and ledger reversal posted.", data: expense });
  } catch (error) {
    await t.rollback();
    console.error("[voidExpense]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   SOCIETIES DROPDOWN FOR GLOBAL SUPER ADMIN
   GET /api/account/societies  (each returned with balance snapshot + expenses)
══════════════════════════════════════════════════════════════════════════ */
const getSocietiesOverview = async (req, res) => {
  try {
    if (req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Only Super Admin can browse societies." });
    }
    const societies = await Society.findAll({
      attributes: ["id", "name", "address", "opening_balance", "opening_balance_effective_date", "created_at"],
      order: [["name", "ASC"]],
    });

    const data = await Promise.all(
      societies.map(async (s) => {
        const [row] = await sequelize.query(
          `SELECT
             COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
             COALESCE(SUM(CASE WHEN type = 'DEBIT'  THEN amount ELSE 0 END), 0) AS total_debit,
             COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS total_expenses
           FROM ledger_entries WHERE society_id = ?`,
          { replacements: [s.id] }
        );
        const credit = Number(row[0].total_credit) || 0;
        const debit = Number(row[0].total_debit) || 0;
        return {
          ...s.toJSON(),
          total_expenses: Number(row[0].total_expenses) || 0,
          total_income: Math.round((Number(row[0].total_credit) - 0) * 100) / 100,
          current_balance: Math.round((Number(s.opening_balance) + credit - debit) * 100) / 100,
        };
      })
    );

    return res.json({ success: true, data });
  } catch (error) {
    console.error("[getSocietiesOverview]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   CHART: MONTHLY CREDITED vs DEBITED (dashboard)
   GET /api/account/chart?year=2026&society_id=1
   Society Admin → their own society. Super Admin → chosen society dropdown.
══════════════════════════════════════════════════════════════════════════ */
const getChartData = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const [rows] = await sequelize.query(
      `SELECT
         MONTH(entry_date) AS month,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source IN ('BILL','MAINTENANCE','AMENITY') THEN amount ELSE 0 END), 0) AS credited,
         COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS debited
       FROM ledger_entries
       WHERE society_id = ? AND YEAR(entry_date) = ?
       GROUP BY MONTH(entry_date)`,
      { replacements: [societyId, year] }
    );

    const months = Array.from({ length: 12 }, (_, i) => {
      const found = rows.find((r) => Number(r.month) === i + 1);
      return {
        month: i + 1,
        label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i],
        credited: Math.round(Number(found?.credited || 0) * 100) / 100,
        debited: Math.round(Number(found?.debited || 0) * 100) / 100,
      };
    });

    return res.json({ success: true, data: { society_id: societyId, year, months } });
  } catch (error) {
    console.error("[getChartData]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   AUDIT LOG for a society (read-only view)
   GET /api/account/audit-logs?page=&limit=&society_id=
══════════════════════════════════════════════════════════════════════════ */
const getAuditLogs = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const { count, rows } = await FinancialAuditLog.findAndCountAll({
      where: { society_id: societyId },
      order: [["performed_at", "DESC"]],
      limit,
      offset,
    });

    const enriched = await enrichWithActors(rows, "performed_by", "performed_by_name", "performed_by_role");
    enriched.forEach((r) => { r.created_by_name = r.created_by_name || r.performed_by_name; });

    return res.json({
      success: true,
      data: enriched,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
    });
  } catch (error) {
    console.error("[getAuditLogs]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBalance,
  getLedger,
  setOpeningBalance,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  voidExpense,
  getSocietiesOverview,
  getChartData,
  getAuditLogs,
};