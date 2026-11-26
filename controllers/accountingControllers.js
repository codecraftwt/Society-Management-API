const { Op } = require("sequelize");
const {
  sequelize,
  Society,
  Expense,
  ExpenseCategory,
  SocietyFinancialAccount,
  FixedDeposit,
  LedgerEntry,
  FinancialAuditLog,
  Bill,
  Flat,
  FlatMembership,
  User,
  AmenityBooking,
  Amenity,
} = require("../models");
const {
  createLedgerEntry,
  reverseLedgerEntry,
  auditLog,
  resolveActorRole,
  ensureCashAccount,
  applyAccountBalanceDelta,
  VALID_SOURCES,
} = require("../utils/ledgerService");
const { formatAccount, maskAccountNumber } = require("./financialAccountControllers");

const OPERATIONAL_INCOME_SOURCES = ["BILL", "MAINTENANCE", "AMENITY", "FD_INTEREST", "CASH_IN"];

/* ── User identity enrichment ────────────────────────────────────────────── */
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
    const j = r.toJSON ? r.toJSON() : { ...r };
    const info = map.get(j[idField]);
    if (info) {
      j[nameField] = info.name;
      if (roleField) j[roleField] = info.role;
    }
    return j;
  });
}

function resolveSocietyId(req) {
  if (req.user.activeRole === "SUPER_ADMIN") {
    return parseInt(req.headers["x-society-id"] || req.query.society_id, 10) || req.user.society_id;
  }
  return req.user.society_id;
}

async function getSocietyMeta(societyId) {
  if (!societyId) return null;
  return Society.findByPk(societyId, {
    attributes: [
      "id",
      "name",
      "address",
      "opening_balance",
      "opening_balance_effective_date",
      "opening_balance_set_at",
      "accounting_mode",
      "accounting_cutover_date",
    ],
  });
}

/* Resolve filter param ?financial_account_id= (ALL | CASH | LEGACY | numeric id) */
async function resolveAccountFilter(societyId, rawParam) {
  if (!rawParam || String(rawParam).toUpperCase() === "ALL") {
    return { mode: "ALL", account: null };
  }
  const upper = String(rawParam).toUpperCase();
  if (upper === "LEGACY") {
    return { mode: "LEGACY", account: null };
  }
  if (upper === "CASH") {
    const cash = await ensureCashAccount(societyId);
    return { mode: "ACCOUNT", account: cash };
  }
  const id = parseInt(rawParam, 10);
  if (!Number.isInteger(id) || id <= 0) return { mode: "ALL", account: null };
  const acc = await SocietyFinancialAccount.findOne({ where: { id, society_id: societyId } });
  return acc ? { mode: "ACCOUNT", account: acc } : { mode: "NONE", account: null };
}

/* Resolve Expense Financial Account based on payment_mode */
async function resolveExpenseAccount({ societyId, paymentMode, rawAccountId, transaction }) {
  if (paymentMode === "CASH") {
    const cash = await ensureCashAccount(societyId, transaction);
    const locked = await SocietyFinancialAccount.findByPk(cash.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked || locked.status !== "ACTIVE") {
      return { error: "Society Cash Account is inactive." };
    }
    return { account: locked };
  }

  const accId = parseInt(rawAccountId, 10);
  if (!Number.isInteger(accId) || accId <= 0) {
    return {
      error:
        paymentMode === "OTHER"
          ? "Please select a Bank Account or Cash Account for this expense."
          : `Please select an active Bank Account for ${paymentMode} payments.`,
    };
  }

  const acc = await SocietyFinancialAccount.findOne({
    where: { id: accId, society_id: societyId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!acc) {
    return { error: "Selected financial account not found for this society." };
  }
  if (acc.status !== "ACTIVE") {
    return { error: `Account "${acc.account_name}" is inactive and cannot be used for new transactions.` };
  }
  if (["BANK_TRANSFER", "UPI", "CHEQUE"].includes(paymentMode) && acc.account_type === "CASH") {
    return { error: `${paymentMode} payments must use a registered Bank Account, not Cash.` };
  }
  return { account: acc };
}

/* ══════════════════════════════════════════════════════════════════════════
   GET SOCIETY BALANCE & DASHBOARD SUMMARY
   GET /api/account/balance?financial_account_id=
══════════════════════════════════════════════════════════════════════════ */
const getBalance = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const society = await getSocietyMeta(societyId);
    if (!society) return res.status(404).json({ success: false, message: "Society not found." });

    await ensureCashAccount(societyId);
    const accounts = await SocietyFinancialAccount.findAll({
      where: { society_id: societyId },
      order: [
        [sequelize.literal("CASE WHEN account_type = 'CASH' THEN 0 ELSE 1 END"), "ASC"],
        ["is_default", "DESC"],
        ["id", "ASC"],
      ],
    });

    const formattedAccounts = accounts.map(formatAccount);
    const bankAccounts = formattedAccounts.filter((a) => a.account_type !== "CASH");
    const cashAccount = formattedAccounts.find((a) => a.account_type === "CASH") || null;

    const totalBankBalance = Math.round(
      bankAccounts.reduce((s, a) => s + Number(a.current_balance || 0), 0) * 100
    ) / 100;
    const totalCashBalance = Math.round((Number(cashAccount?.current_balance || 0)) * 100) / 100;

    // Legacy vs Multi-Account cutover calculation (zero double-counting)
    const isLegacyMode =
      society.accounting_mode !== "MULTI_ACCOUNT" &&
      bankAccounts.length === 0 &&
      Number(cashAccount?.opening_balance || 0) === 0;

    let legacyBalance = 0;
    if (isLegacyMode) {
      const [unlinked] = await sequelize.query(
        `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS net_unlinked
         FROM ledger_entries
         WHERE society_id = ? AND financial_account_id IS NULL`,
        { replacements: [societyId] }
      );
      legacyBalance = Math.round((Number(society.opening_balance || 0) + Number(unlinked[0]?.net_unlinked || 0)) * 100) / 100;
    }

    const totalLiquidBalance = Math.round(
      (isLegacyMode ? legacyBalance + totalCashBalance : totalBankBalance + totalCashBalance) * 100
    ) / 100;

    // Active FD Investment (both EXISTING and NEW active FDs)
    const [fdSumRows] = await sequelize.query(
      `SELECT COALESCE(SUM(principal_amount), 0) AS active_fd_principal,
              COUNT(*) AS active_fd_count
       FROM fixed_deposits
       WHERE society_id = ? AND status = 'ACTIVE'`,
      { replacements: [societyId] }
    );
    const totalFdInvestment = Math.round(Number(fdSumRows[0]?.active_fd_principal || 0) * 100) / 100;
    const totalFinancialAssets = Math.round((totalLiquidBalance + totalFdInvestment) * 100) / 100;

    // Filter-aware Operational Income & Expense KPIs (excludes voided/reversed & non-operational transfers)
    const accFilter = await resolveAccountFilter(societyId, req.query.financial_account_id);
    let accSql = "";
    const replacements = [societyId];
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      accSql = " AND financial_account_id = ?";
      replacements.push(accFilter.account.id);
    } else if (accFilter.mode === "LEGACY") {
      accSql = " AND financial_account_id IS NULL";
    } else if (accFilter.mode === "NONE") {
      accSql = " AND 1 = 0";
    }

    const [sums] = await sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source IN ('BILL','MAINTENANCE','AMENITY','FD_INTEREST','CASH_IN') AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'BILL' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS bill_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'MAINTENANCE' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS maintenance_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'AMENITY' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS amenity_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'FD_INTEREST' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS fd_interest_income,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'CASH_IN' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS cash_in_income,
         COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS total_expenses,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source = 'EXPENSE' THEN amount ELSE 0 END), 0) AS void_reversals
       FROM ledger_entries
       WHERE society_id = ?${accSql}`,
      { replacements }
    );

    const selectedAccount = accFilter.mode === "ACCOUNT" ? formatAccount(accFilter.account) : null;
    const displayedOpening = selectedAccount
      ? selectedAccount.opening_balance
      : isLegacyMode
      ? Number(society.opening_balance || 0)
      : Math.round(formattedAccounts.reduce((s, a) => s + Number(a.opening_balance || 0), 0) * 100) / 100;

    const displayedCurrent = selectedAccount ? selectedAccount.current_balance : totalLiquidBalance;

    return res.json({
      success: true,
      data: {
        society_id: society.id,
        society_name: society.name,
        accounting_mode: isLegacyMode ? "LEGACY" : "MULTI_ACCOUNT",
        accounting_cutover_date: society.accounting_cutover_date,
        opening_balance: displayedOpening,
        opening_balance_effective_date: selectedAccount
          ? selectedAccount.opening_balance_date
          : society.opening_balance_effective_date,
        opening_balance_set_at: society.opening_balance_set_at,
        total_income: Number(sums[0].total_income) || 0,
        bill_income: Number(sums[0].bill_income) || 0,
        maintenance_income: Number(sums[0].maintenance_income) || 0,
        amenity_income: Number(sums[0].amenity_income) || 0,
        fd_interest_income: Number(sums[0].fd_interest_income) || 0,
        cash_in_income: Number(sums[0].cash_in_income) || 0,
        total_expenses: Number(sums[0].total_expenses) || 0,
        void_reversals: Number(sums[0].void_reversals) || 0,
        current_balance: displayedCurrent,
        total_bank_balance: totalBankBalance,
        total_cash_balance: totalCashBalance,
        legacy_balance: legacyBalance,
        total_liquid_balance: totalLiquidBalance,
        total_fd_investment: totalFdInvestment,
        active_fd_count: Number(fdSumRows[0]?.active_fd_count || 0),
        total_financial_assets: totalFinancialAssets,
        has_default_bank: bankAccounts.some((a) => a.is_default && a.status === "ACTIVE"),
        accounts: formattedAccounts,
      },
    });
  } catch (error) {
    console.error("[getBalance]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   GET LEDGER (Cash Book & General Ledger)
   GET /api/account/ledger?page=1&limit=20&financial_account_id=&type=&source=&from=&to=
══════════════════════════════════════════════════════════════════════════ */
const getLedger = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const society = await getSocietyMeta(societyId);
    const accounts = await SocietyFinancialAccount.findAll({ where: { society_id: societyId } });
    const accountById = new Map(accounts.map((a) => [a.id, formatAccount(a)]));

    const accFilter = await resolveAccountFilter(societyId, req.query.financial_account_id);
    if (accFilter.mode === "NONE") {
      return res.json({
        success: true,
        data: [],
        pagination: { currentPage: page, totalPages: 1, totalItems: 0, limit },
        opening_balance: 0,
        society_name: society?.name || null,
      });
    }

    const where = { society_id: societyId };
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      where.financial_account_id = accFilter.account.id;
      if (accFilter.account.opening_balance_date) {
        where.entry_date = { [Op.gte]: accFilter.account.opening_balance_date };
      }
    } else if (accFilter.mode === "LEGACY") {
      where.financial_account_id = null;
    }

    if (req.query.type && ["CREDIT", "DEBIT"].includes(req.query.type.toUpperCase())) {
      where.type = req.query.type.toUpperCase();
    }
    if (req.query.source && VALID_SOURCES.includes(req.query.source.toUpperCase())) {
      where.source = req.query.source.toUpperCase();
    }
    if (req.query.search && req.query.search.trim()) {
      where.description = { [Op.like]: `%${req.query.search.trim()}%` };
    }
    if (req.query.from && req.query.to) {
      where.entry_date = where.entry_date
        ? { [Op.and]: [where.entry_date, { [Op.between]: [req.query.from, req.query.to] }] }
        : { [Op.between]: [req.query.from, req.query.to] };
    } else if (req.query.from) {
      where.entry_date = where.entry_date
        ? { [Op.and]: [where.entry_date, { [Op.gte]: req.query.from }] }
        : { [Op.gte]: req.query.from };
    } else if (req.query.to) {
      where.entry_date = where.entry_date
        ? { [Op.and]: [where.entry_date, { [Op.lte]: req.query.to }] }
        : { [Op.lte]: req.query.to };
    }

    const isDesc = req.query.order?.toUpperCase() !== "ASC" && req.query.sort?.toUpperCase() !== "ASC";
    const order = isDesc
      ? [["entry_date", "DESC"], ["id", "DESC"]]
      : [["entry_date", "ASC"], ["id", "ASC"]];

    const { count, rows } = await LedgerEntry.findAndCountAll({
      where,
      order,
      limit,
      offset,
    });

    // Enrich polymorphic references
    const intake = {};
    for (const r of rows) {
      const src = r.source === "ADJUSTMENT" ? "ADJUSTMENT" : r.source;
      if (!r.reference_id || ["ADJUSTMENT", "OPENING", "CASH_IN", "ACCOUNT_TRANSFER"].includes(src)) continue;
      (intake[src] ||= []).push(r.reference_id);
    }
    const uniq = (arr = []) => [...new Set(arr)];

    const billRows =
      intake.BILL?.length || intake.MAINTENANCE?.length
        ? await Bill.findAll({
            where: { id: { [Op.in]: uniq([...(intake.BILL || []), ...(intake.MAINTENANCE || [])]) } },
            attributes: ["id", "title", "type", "billing_month", "issue_date", "due_date"],
            include: [
              {
                model: Flat,
                required: false,
                attributes: ["id", "flat_number"],
                include: [
                  { model: User, required: false, attributes: ["id", "name"] },
                  {
                    model: FlatMembership,
                    required: false,
                    where: { role: "OWNER", is_current: true },
                    include: [{ model: User, required: false, attributes: ["id", "name"] }],
                  },
                ],
              },
            ],
          })
        : [];
    const billDetailById = new Map(
      billRows.map((b) => [
        b.id,
        {
          title: b.title,
          bill_type: b.type,
          billing_month: b.billing_month,
          issue_date: b.issue_date ? b.issue_date.toISOString().slice(0, 10) : null,
          due_date: b.due_date ? b.due_date.toISOString().slice(0, 10) : null,
          payer_name: b.Flat?.FlatMemberships?.[0]?.User?.name || b.Flat?.User?.name || null,
          flat_number: b.Flat?.flat_number || null,
        },
      ])
    );

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
    const amenityDetailById = new Map(
      amenityRows.map((b) => [
        b.id,
        {
          amenity_name: b.Amenity?.name || null,
          booked_date: b.date || null,
          booker_name: b.User?.name || null,
          booker_id: b.User?.id || null,
        },
      ])
    );

    const expenseRows = intake.EXPENSE?.length
      ? await Expense.findAll({
          where: { id: { [Op.in]: uniq(intake.EXPENSE) } },
          attributes: ["id", "pay_to", "reason", "amount", "payment_date", "payment_mode", "paid_by", "status", "expense_category_id"],
          include: [{ model: ExpenseCategory, as: "category", required: false, attributes: ["id", "name"] }],
        })
      : [];
    const expenseDetailById = new Map(
      expenseRows.map((e) => [
        e.id,
        {
          pay_to: e.pay_to,
          reason: e.reason,
          payment_date: e.payment_date || null,
          payment_mode: e.payment_mode,
          paid_by: e.paid_by,
          status: e.status,
          category_name: e.category?.name || null,
        },
      ])
    );

    const resolveDetail = (r) => {
      if (!r.reference_id) return null;
      if (r.source === "BILL" || r.source === "MAINTENANCE") return billDetailById.get(r.reference_id) || null;
      if (r.source === "AMENITY") return amenityDetailById.get(r.reference_id) || null;
      if (r.source === "EXPENSE") return expenseDetailById.get(r.reference_id) || null;
      return null;
    };

    const isLegacyMode =
      society?.accounting_mode !== "MULTI_ACCOUNT" &&
      accounts.filter((a) => a.account_type !== "CASH").length === 0 &&
      Number(accounts.find((a) => a.account_type === "CASH")?.opening_balance || 0) === 0;

    let opening = 0;
    let openingDate = null;
    let openingLabel = "Opening balance (pre-tracking funds)";
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      opening = Number(accFilter.account.opening_balance || 0);
      openingDate = accFilter.account.opening_balance_date || null;
      openingLabel = `Opening balance (${accFilter.account.account_name})`;
    } else if (accFilter.mode === "LEGACY" || isLegacyMode) {
      opening = Number(society?.opening_balance || 0);
      openingDate = society?.opening_balance_effective_date || null;
    } else {
      opening = accounts.reduce((s, a) => s + Number(a.opening_balance || 0), 0);
      openingLabel = "Opening balance across Bank & Cash accounts";
    }

    // Running balance SQL scope (sums ALL POSTED + REVERSED so reversals cancel originals)
    let balAccSql = "";
    const balBaseRepl = { society_id: societyId };
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      balAccSql = " AND financial_account_id = :acc_id";
      balBaseRepl.acc_id = accFilter.account.id;
      if (accFilter.account.opening_balance_date) {
        balAccSql += " AND entry_date >= :acc_open_date";
        balBaseRepl.acc_open_date = accFilter.account.opening_balance_date;
      }
    } else if (accFilter.mode === "LEGACY") {
      balAccSql = " AND financial_account_id IS NULL";
    } else if (!isLegacyMode) {
      // In MULTI_ACCOUNT mode, exclude unlinked pre-cutover entries from live account running balance
      balAccSql = " AND financial_account_id IS NOT NULL";
    }

    const enrichRowMeta = (r) => {
      const json = r.toJSON ? r.toJSON() : { ...r };
      const acc = json.financial_account_id ? accountById.get(json.financial_account_id) : null;
      const detail = resolveDetail(r);
      return {
        ...json,
        financialAccount: acc || null,
        account_name: acc ? acc.account_name : "Legacy / Unassigned",
        account_type: acc ? acc.account_type : "LEGACY",
        bank_name: acc?.bank_name || null,
        masked_account_number: acc?.masked_account_number || null,
        expense_category_name: detail?.category_name || null,
        detail,
      };
    };

    let entries = [];
    if (isDesc) {
      let runningBalance = opening;
      if (rows.length > 0) {
        const boundary = { entry_date: rows[0].entry_date, id: rows[0].id };
        const [before] = await sequelize.query(
          `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS bal
           FROM ledger_entries
           WHERE society_id = :society_id${balAccSql}
             AND (entry_date < :entry_date OR (entry_date = :entry_date AND id <= :id))`,
          { replacements: { ...balBaseRepl, ...boundary } }
        );
        runningBalance += Number(before[0]?.bal) || 0;
      }
      entries = rows.map((r) => {
        const current = runningBalance;
        runningBalance -= r.type === "CREDIT" ? Number(r.amount) : -Number(r.amount);
        return { ...enrichRowMeta(r), running_balance: Math.round(current * 100) / 100 };
      });
    } else {
      let runningBalance = opening;
      if (offset > 0 && rows.length > 0) {
        const boundary = { entry_date: rows[0].entry_date, id: rows[0].id };
        const [before] = await sequelize.query(
          `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS bal
           FROM ledger_entries
           WHERE society_id = :society_id${balAccSql}
             AND (entry_date < :entry_date OR (entry_date = :entry_date AND id < :id))`,
          { replacements: { ...balBaseRepl, ...boundary } }
        );
        runningBalance += Number(before[0]?.bal) || 0;
      }
      entries = rows.map((r) => {
        runningBalance += r.type === "CREDIT" ? Number(r.amount) : -Number(r.amount);
        return { ...enrichRowMeta(r), running_balance: Math.round(runningBalance * 100) / 100 };
      });
    }

    const hasTypeFilter = Boolean(req.query.type && req.query.type.trim());
    const isCreditType = req.query.type?.toUpperCase() === "CREDIT";
    const hasSourceFilter = Boolean(req.query.source && req.query.source.trim());
    const isOpeningSource = req.query.source?.toUpperCase() === "OPENING";
    const hasSearch = Boolean(req.query.search && req.query.search.trim());

    const allowsOpening =
      (!hasTypeFilter || isCreditType) &&
      (!hasSourceFilter || isOpeningSource) &&
      (!hasSearch || openingLabel.toLowerCase().includes(req.query.search.trim().toLowerCase())) &&
      (!req.query.from || (openingDate && openingDate >= req.query.from)) &&
      (!req.query.to || (openingDate && openingDate <= req.query.to));

    const openingRow = {
      id: null,
      type: "CREDIT",
      source: "OPENING",
      reference_id: null,
      amount: opening,
      entry_date: openingDate,
      description: openingLabel,
      status: "POSTED",
      account_name: accFilter.account ? accFilter.account.account_name : "All Accounts",
      account_type: accFilter.account ? accFilter.account.account_type : "SUMMARY",
      created_at: society?.opening_balance_set_at || null,
      running_balance: opening,
      opening: true,
    };

    let dataEntries = entries;
    if (!isDesc && page === 1 && allowsOpening && opening > 0) {
      dataEntries = [openingRow, ...entries];
    } else if (isDesc && offset + rows.length >= count && allowsOpening && opening > 0) {
      dataEntries = [...entries, openingRow];
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
   SET / ADJUST LEGACY OPENING BALANCE
   PUT /api/account/opening-balance
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

    await society.update(
      {
        opening_balance: Math.round(amount * 100) / 100,
        opening_balance_effective_date: effectiveDate,
        opening_balance_set_by: req.user.id,
        opening_balance_set_at: new Date(),
      },
      { transaction: t }
    );

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
   GET /api/expenses?page=&limit=&from=&to=&status=&search=&financial_account_id=&expense_category_id=
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
    if (req.query.expense_category_id) {
      where.expense_category_id = parseInt(req.query.expense_category_id, 10);
    }

    const accFilter = await resolveAccountFilter(societyId, req.query.financial_account_id);
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      where.financial_account_id = accFilter.account.id;
    } else if (accFilter.mode === "LEGACY") {
      where.financial_account_id = null;
    } else if (accFilter.mode === "NONE") {
      return res.json({
        success: true,
        data: [],
        pagination: { currentPage: page, totalPages: 1, totalItems: 0, limit },
        totals: { posted_total: 0, grand_total: 0, total_count: 0, void_count: 0 },
      });
    }

    if (req.query.search) {
      where[Op.or] = [
        { pay_to: { [Op.like]: `%${req.query.search}%` } },
        { reason: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    const { count, rows } = await Expense.findAndCountAll({
      where,
      include: [
        {
          model: SocietyFinancialAccount,
          as: "financialAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number"],
        },
        {
          model: ExpenseCategory,
          as: "category",
          required: false,
          attributes: ["id", "name", "status"],
        },
      ],
      order: [["payment_date", "DESC"], ["id", "DESC"]],
      limit,
      offset,
    });

    let totalsSql = "";
    const totRepl = [societyId];
    if (where.financial_account_id !== undefined) {
      if (where.financial_account_id === null) totalsSql = " AND financial_account_id IS NULL";
      else {
        totalsSql = " AND financial_account_id = ?";
        totRepl.push(where.financial_account_id);
      }
    }

    const [totals] = await sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'POSTED' THEN amount ELSE 0 END), 0) AS posted_total,
         COALESCE(SUM(amount), 0) AS grand_total,
         COUNT(*) AS total_count,
         COALESCE(SUM(CASE WHEN status = 'VOID' THEN 1 ELSE 0 END), 0) AS void_count
       FROM expenses WHERE society_id = ?${totalsSql}`,
      { replacements: totRepl }
    );

    const enriched = await enrichWithActors(rows, "created_by", "created_by_name", "created_by_role");
    enriched.forEach((r) => {
      if (r.financialAccount) {
        r.financialAccount.masked_account_number =
          r.financialAccount.account_type === "CASH"
            ? "CASH"
            : maskAccountNumber(r.financialAccount.account_number);
        delete r.financialAccount.account_number;
      }
    });

    return res.json({
      success: true,
      data: enriched,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit) || 1, totalItems: count, limit },
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
    const expense = await Expense.findOne({
      where: { id: req.params.id, society_id: societyId },
      include: [
        {
          model: SocietyFinancialAccount,
          as: "financialAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number"],
        },
        {
          model: ExpenseCategory,
          as: "category",
          required: false,
          attributes: ["id", "name", "status"],
        },
      ],
    });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found." });
    const data = (await enrichWithActors([expense], "created_by", "created_by_name", "created_by_role"))[0];
    if (data.financialAccount) {
      data.financialAccount.masked_account_number =
        data.financialAccount.account_type === "CASH"
          ? "CASH"
          : maskAccountNumber(data.financialAccount.account_number);
      delete data.financialAccount.account_number;
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   CREATE EXPENSE  (money out → Ledger DEBIT + Account Balance Deduction)
   POST /api/expenses
══════════════════════════════════════════════════════════════════════════ */
const createExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society could not be resolved." });
    }

    const { pay_to, reason, amount, payment_date, payment_mode, financial_account_id, expense_category_id } = req.body;
    const receipt = req.file
      ? {
          receipt_url: req.file.path,
          receipt_file_name: req.file.originalname,
          receipt_mime_type: req.file.mimetype,
          receipt_file_size: req.file.size,
          receipt_public_id: req.file.filename,
        }
      : {};

    if (!pay_to || !reason || amount === undefined) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "pay_to, reason and amount are required." });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Amount must be a positive number." });
    }

    // Validate expense category if provided or if society has active categories
    let resolvedCategoryId = null;
    if (expense_category_id !== undefined && expense_category_id !== null && expense_category_id !== "") {
      const cat = await ExpenseCategory.findOne({
        where: { id: parseInt(expense_category_id, 10), society_id: societyId },
        transaction: t,
      });
      if (!cat) {
        await t.rollback();
        return res.status(404).json({ success: false, message: "Expense category not found." });
      }
      if (cat.status !== "ACTIVE") {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Expense category "${cat.name}" is inactive.` });
      }
      resolvedCategoryId = cat.id;
    }

    const VALID_PAID_BY = ["SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER", "SUPER_ADMIN"];
    const VALID_PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"];
    const rawPaidBy = (req.body.paid_by || req.user.activeRole || req.user.role || "SOCIETY_ADMIN").toUpperCase();
    const paidBy = VALID_PAID_BY.includes(rawPaidBy) ? rawPaidBy : "SOCIETY_ADMIN";
    const rawMode = (payment_mode || "CASH").toUpperCase();
    const resolvedPaymentMode = VALID_PAYMENT_MODES.includes(rawMode) ? rawMode : "CASH";

    const { account, error: accError } = await resolveExpenseAccount({
      societyId,
      paymentMode: resolvedPaymentMode,
      rawAccountId: financial_account_id,
      transaction: t,
    });
    if (accError) {
      await t.rollback();
      return res.status(400).json({ success: false, message: accError });
    }

    const payDate = payment_date || new Date().toISOString().slice(0, 10);
    if (account.opening_balance_date && payDate < account.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Expense date cannot precede ${account.account_name} opening balance date (${account.opening_balance_date}).`,
      });
    }

    if (Number(account.current_balance) < amt) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in ${account.account_name}. Available: ₹${Number(account.current_balance).toFixed(2)}, Required: ₹${amt.toFixed(2)}`,
      });
    }

    const expense = await Expense.create(
      {
        society_id: societyId,
        financial_account_id: account.id,
        expense_category_id: resolvedCategoryId,
        pay_to: pay_to.toString().trim(),
        reason: reason.toString().trim(),
        amount: amt,
        payment_date: payDate,
        paid_by: paidBy,
        payment_mode: resolvedPaymentMode,
        ...receipt,
        status: "POSTED",
        created_by: req.user.id,
      },
      { transaction: t }
    );

    await createLedgerEntry({
      societyId,
      type: "DEBIT",
      source: "EXPENSE",
      referenceId: expense.id,
      amount: amt,
      entryDate: expense.payment_date,
      description: `Expense: ${reason} (paid to ${pay_to})`,
      financialAccountId: account.id,
      actor: req.user,
      transaction: t,
    });

    const formattedAmt = `₹${Number(amt).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const cleanReason = (expense.reason || "").toString().trim();
    const auditReason = cleanReason
      ? `Paid ${formattedAmt} from ${account.account_name} to ${expense.pay_to} for ${cleanReason}`
      : `Paid ${formattedAmt} from ${account.account_name} to ${expense.pay_to}`;

    await auditLog({
      societyId,
      action: "EXPENSE_CREATE",
      entityType: "Expense",
      entityId: expense.id,
      newValue: expense.toJSON(),
      reason: auditReason,
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
   UPDATE EXPENSE  (only while POSTED; syncs ledger & account balances)
   PUT /api/expenses/:id
══════════════════════════════════════════════════════════════════════════ */
const updateExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const expense = await Expense.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
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
    if (req.body.payment_date !== undefined) updates.payment_date = req.body.payment_date;
    if (req.file) {
      Object.assign(updates, {
        receipt_url: req.file.path,
        receipt_file_name: req.file.originalname,
        receipt_mime_type: req.file.mimetype,
        receipt_file_size: req.file.size,
        receipt_public_id: req.file.filename,
      });
    }
    if (String(req.body.remove_receipt).toLowerCase() === "true") {
      Object.assign(updates, {
        receipt_url: null,
        receipt_file_name: null,
        receipt_mime_type: null,
        receipt_file_size: null,
        receipt_public_id: null,
      });
    }

    if (req.body.expense_category_id !== undefined) {
      if (req.body.expense_category_id === null || req.body.expense_category_id === "") {
        updates.expense_category_id = null;
      } else {
        const cat = await ExpenseCategory.findOne({
          where: { id: parseInt(req.body.expense_category_id, 10), society_id: societyId },
          transaction: t,
        });
        if (!cat) {
          await t.rollback();
          return res.status(404).json({ success: false, message: "Expense category not found." });
        }
        if (cat.status !== "ACTIVE" && cat.id !== expense.expense_category_id) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `Expense category "${cat.name}" is inactive.` });
        }
        updates.expense_category_id = cat.id;
      }
    }

    let nextAmt = Number(expense.amount);
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Amount must be a positive number." });
      }
      updates.amount = amt;
      nextAmt = amt;
    }

    const nextMode =
      req.body.payment_mode !== undefined
        ? (["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"].includes(req.body.payment_mode.toUpperCase())
            ? req.body.payment_mode.toUpperCase()
            : "CASH")
        : expense.payment_mode;
    if (req.body.payment_mode !== undefined) updates.payment_mode = nextMode;

    // Resolve target account if mode or financial_account_id changed, or if expense already has one
    let nextAccountId = expense.financial_account_id;
    const rawRequestedAcc = req.body.financial_account_id !== undefined ? req.body.financial_account_id : expense.financial_account_id;
    if (req.body.payment_mode !== undefined || req.body.financial_account_id !== undefined) {
      const { account: resolvedAcc, error: accErr } = await resolveExpenseAccount({
        societyId,
        paymentMode: nextMode,
        rawAccountId: rawRequestedAcc,
        transaction: t,
      });
      if (accErr) {
        await t.rollback();
        return res.status(400).json({ success: false, message: accErr });
      }
      nextAccountId = resolvedAcc.id;
      updates.financial_account_id = nextAccountId;
    }

    const oldAmt = Number(oldValue.amount);
    const oldAccId = oldValue.financial_account_id;
    const nextDate = updates.payment_date || expense.payment_date;

    // Reconcile account balance changes atomically
    if (oldAccId && nextAccountId && oldAccId === nextAccountId) {
      const acc = await SocietyFinancialAccount.findByPk(oldAccId, { transaction: t, lock: t.LOCK.UPDATE });
      if (acc) {
        if (acc.opening_balance_date && nextDate < acc.opening_balance_date) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `Date cannot precede ${acc.account_name} opening date.` });
        }
        const delta = Math.round((oldAmt - nextAmt) * 100) / 100; // positive = refund, negative = extra debit
        const newBal = Math.round((Number(acc.current_balance) + delta) * 100) / 100;
        if (newBal < 0) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient balance in ${acc.account_name} for updated amount.`,
          });
        }
        await acc.update({ current_balance: newBal }, { transaction: t });
      }
    } else {
      if (oldAccId) {
        await applyAccountBalanceDelta({ financialAccountId: oldAccId, delta: oldAmt, transaction: t });
      }
      if (nextAccountId) {
        const newAcc = await SocietyFinancialAccount.findByPk(nextAccountId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!newAcc || newAcc.status !== "ACTIVE") {
          await t.rollback();
          return res.status(400).json({ success: false, message: "Selected financial account is inactive." });
        }
        if (newAcc.opening_balance_date && nextDate < newAcc.opening_balance_date) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `Date cannot precede ${newAcc.account_name} opening date.` });
        }
        if (Number(newAcc.current_balance) < nextAmt) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient balance in ${newAcc.account_name}. Available: ₹${Number(newAcc.current_balance).toFixed(2)}`,
          });
        }
        await newAcc.update(
          { current_balance: Math.round((Number(newAcc.current_balance) - nextAmt) * 100) / 100 },
          { transaction: t }
        );
      }
    }

    await expense.update(updates, { transaction: t });

    const debit = await LedgerEntry.findOne({
      where: { society_id: societyId, source: "EXPENSE", reference_id: expense.id, type: "DEBIT" },
      transaction: t,
    });
    if (debit) {
      await debit.update(
        {
          amount: nextAmt,
          financial_account_id: nextAccountId || null,
          entry_date: nextDate,
          description: `Expense: ${expense.reason} (paid to ${expense.pay_to})`,
        },
        { transaction: t }
      );
    }

    const formattedAmt = `₹${Number(expense.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const cleanReason = (expense.reason || "").toString().trim();
    const auditReason =
      oldAmt !== Number(expense.amount)
        ? `Updated payment for ${expense.pay_to}: ₹${oldAmt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to ${formattedAmt}${cleanReason ? ` (${cleanReason})` : ""}`
        : cleanReason
        ? `Updated payment for ${expense.pay_to} (${cleanReason} - ${formattedAmt})`
        : `Updated payment details for ${expense.pay_to}`;

    await auditLog({
      societyId,
      action: "EXPENSE_UPDATE",
      entityType: "Expense",
      entityId: expense.id,
      oldValue,
      newValue: expense.toJSON(),
      reason: auditReason,
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
   VOID EXPENSE  (soft delete + reversed ledger impact + restore balance)
   DELETE /api/expenses/:id
══════════════════════════════════════════════════════════════════════════ */
const voidExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const expense = await Expense.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
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

    const formattedAmt = `₹${Number(expense.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const userReason = (req.body?.reason || "").toString().trim();
    const cleanReason = (expense.reason || "").toString().trim();
    const auditReason = userReason
      ? `Cancelled payment to ${expense.pay_to}: ${userReason}`
      : cleanReason
      ? `Cancelled payment of ${formattedAmt} to ${expense.pay_to} (${cleanReason})`
      : `Cancelled payment of ${formattedAmt} to ${expense.pay_to}`;

    await auditLog({
      societyId,
      action: "EXPENSE_VOID",
      entityType: "Expense",
      entityId: expense.id,
      oldValue: { status: "POSTED" },
      newValue: { status: "VOID" },
      reason: auditReason,
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
   SOCIETIES OVERVIEW (GLOBAL SUPER ADMIN)
   GET /api/account/societies
══════════════════════════════════════════════════════════════════════════ */
const getSocietiesOverview = async (req, res) => {
  try {
    if (req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Only Super Admin can browse societies." });
    }
    const societies = await Society.findAll({
      attributes: ["id", "name", "address", "opening_balance", "opening_balance_effective_date", "accounting_mode", "created_at"],
      order: [["name", "ASC"]],
    });

    const data = await Promise.all(
      societies.map(async (s) => {
        const [row] = await sequelize.query(
          `SELECT
             COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source IN ('BILL','MAINTENANCE','AMENITY','FD_INTEREST','CASH_IN') AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS total_income,
             COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS total_expenses,
             COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS net_ledger
           FROM ledger_entries WHERE society_id = ?`,
          { replacements: [s.id] }
        );
        const accounts = await SocietyFinancialAccount.findAll({ where: { society_id: s.id } });
        const liquidBalance =
          s.accounting_mode === "MULTI_ACCOUNT" && accounts.length > 0
            ? Math.round(accounts.reduce((sum, a) => sum + Number(a.current_balance || 0), 0) * 100) / 100
            : Math.round((Number(s.opening_balance || 0) + Number(row[0].net_ledger || 0)) * 100) / 100;

        return {
          ...s.toJSON(),
          total_expenses: Number(row[0].total_expenses) || 0,
          total_income: Number(row[0].total_income) || 0,
          current_balance: liquidBalance,
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
   CHART: MONTHLY CREDITED vs DEBITED
   GET /api/account/chart?year=2026&society_id=1&financial_account_id=
══════════════════════════════════════════════════════════════════════════ */
const getChartData = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const accFilter = await resolveAccountFilter(societyId, req.query.financial_account_id);
    let accSql = "";
    const replacements = [societyId, year];
    if (accFilter.mode === "ACCOUNT" && accFilter.account) {
      accSql = " AND financial_account_id = ?";
      replacements.push(accFilter.account.id);
    } else if (accFilter.mode === "LEGACY") {
      accSql = " AND financial_account_id IS NULL";
    } else if (accFilter.mode === "NONE") {
      accSql = " AND 1 = 0";
    }

    const [rows] = await sequelize.query(
      `SELECT
         MONTH(entry_date) AS month,
         COALESCE(SUM(CASE WHEN type = 'CREDIT' AND source IN ('BILL','MAINTENANCE','AMENITY','FD_INTEREST','CASH_IN') AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS credited,
         COALESCE(SUM(CASE WHEN type = 'DEBIT'  AND source = 'EXPENSE' AND status = 'POSTED' AND reversal_of_id IS NULL THEN amount ELSE 0 END), 0) AS debited
       FROM ledger_entries
       WHERE society_id = ? AND YEAR(entry_date) = ?${accSql}
       GROUP BY MONTH(entry_date)`,
      { replacements }
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
   AUDIT LOG
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
    enriched.forEach((r) => {
      r.created_by_name = r.created_by_name || r.performed_by_name;
    });

    return res.json({
      success: true,
      data: enriched,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit) || 1, totalItems: count, limit },
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
  OPERATIONAL_INCOME_SOURCES,
};
