const { Op } = require("sequelize");
const {
  sequelize,
  Society,
  SocietyFinancialAccount,
  LedgerEntry,
  MaintenanceRate,
} = require("../models");
const {
  createLedgerEntry,
  auditLog,
  ensureCashAccount,
} = require("../utils/ledgerService");

function resolveSocietyId(req) {
  if (req.user.activeRole === "SUPER_ADMIN") {
    return parseInt(req.headers["x-society-id"] || req.query.society_id || req.body?.society_id, 10) || req.user.society_id;
  }
  return req.user.society_id;
}

function maskAccountNumber(num) {
  if (!num) return null;
  const s = String(num).trim();
  if (s.length <= 4) return s;
  return `${"X".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

function formatAccount(acc) {
  const j = acc.toJSON ? acc.toJSON() : { ...acc };
  j.masked_account_number = j.account_type === "CASH" ? "CASH" : maskAccountNumber(j.account_number);
  j.opening_balance = Number(j.opening_balance || 0);
  j.current_balance = Number(j.current_balance || 0);
  return j;
}

async function markSocietyMultiAccount(societyId, cutoverDate, transaction) {
  const soc = await Society.findByPk(societyId, { transaction });
  if (!soc) return;
  const updates = {};
  if (soc.accounting_mode !== "MULTI_ACCOUNT") {
    updates.accounting_mode = "MULTI_ACCOUNT";
  }
  if (!soc.accounting_cutover_date) {
    updates.accounting_cutover_date = cutoverDate || new Date().toISOString().slice(0, 10);
  }
  if (Object.keys(updates).length > 0) {
    await soc.update(updates, { transaction });
  }
}

/* ── LIST ACCOUNTS ──────────────────────────────────────────────────────── */
const listAccounts = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    await ensureCashAccount(societyId);

    const where = { society_id: societyId };
    if (req.query.status && ["ACTIVE", "INACTIVE"].includes(req.query.status.toUpperCase())) {
      where.status = req.query.status.toUpperCase();
    }
    if (req.query.type) {
      const tp = req.query.type.toUpperCase();
      if (tp === "BANK") where.account_type = { [Op.ne]: "CASH" };
      else if (tp === "CASH") where.account_type = "CASH";
      else if (["SAVINGS", "CURRENT", "OTHER"].includes(tp)) where.account_type = tp;
    }

    const rows = await SocietyFinancialAccount.findAll({
      where,
      order: [
        [sequelize.literal("CASE WHEN account_type = 'CASH' THEN 0 ELSE 1 END"), "ASC"],
        ["is_default", "DESC"],
        ["id", "ASC"],
      ],
    });

    return res.json({
      success: true,
      data: rows.map(formatAccount),
    });
  } catch (err) {
    console.error("[listAccounts]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── CREATE BANK ACCOUNT ────────────────────────────────────────────────── */
const createAccount = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society could not be resolved." });
    }

    const {
      account_name,
      account_type = "SAVINGS",
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      branch_name,
      opening_balance = 0,
      opening_balance_date,
      is_default = false,
    } = req.body;

    const rawType = String(account_type || "SAVINGS").toUpperCase();
    if (!["SAVINGS", "CURRENT", "CASH", "OTHER"].includes(rawType)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Invalid account_type." });
    }

    const openBal = Number(opening_balance);
    if (!Number.isFinite(openBal) || openBal < 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Opening balance must be a non-negative number." });
    }
    const effDate = opening_balance_date || new Date().toISOString().slice(0, 10);

    if (rawType === "CASH") {
      // Update or initialize the single CASH account
      let cash = await SocietyFinancialAccount.findOne({
        where: { society_id: societyId, account_type: "CASH" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (cash) {
        const delta = Math.round((openBal - Number(cash.opening_balance || 0)) * 100) / 100;
        const nextCur = Math.round((Number(cash.current_balance || 0) + delta) * 100) / 100;
        if (nextCur < 0) {
          await t.rollback();
          return res.status(400).json({ success: false, message: "Opening balance adjustment would make cash balance negative." });
        }
        await cash.update(
          {
            account_name: (account_name || cash.account_name || "Cash in Hand").trim(),
            opening_balance: openBal,
            opening_balance_date: effDate,
            current_balance: nextCur,
          },
          { transaction: t }
        );
      } else {
        cash = await SocietyFinancialAccount.create(
          {
            society_id: societyId,
            account_name: (account_name || "Cash in Hand").trim(),
            account_type: "CASH",
            opening_balance: openBal,
            opening_balance_date: effDate,
            current_balance: openBal,
            is_default: false,
            status: "ACTIVE",
            created_by: req.user.id,
          },
          { transaction: t }
        );
      }
      if (openBal > 0) {
        await markSocietyMultiAccount(societyId, effDate, t);
      }
      await auditLog({
        societyId,
        action: "FINANCIAL_ACCOUNT_UPDATE",
        entityType: "SocietyFinancialAccount",
        entityId: cash.id,
        newValue: formatAccount(cash),
        reason: `Configured Cash Account opening balance to ₹${openBal.toFixed(2)}`,
        actor: req.user,
        transaction: t,
      });
      await t.commit();
      return res.status(201).json({ success: true, data: formatAccount(cash), message: "Cash account updated." });
    }

    // Bank Account validations
    if (!account_name?.trim() || !bank_name?.trim() || !account_holder_name?.trim() || !account_number?.trim() || !ifsc_code?.trim()) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "account_name, bank_name, account_holder_name, account_number, and ifsc_code are required.",
      });
    }

    const cleanNum = String(account_number).trim();
    const dup = await SocietyFinancialAccount.findOne({
      where: { society_id: societyId, account_number: cleanNum },
      transaction: t,
    });
    if (dup) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "A bank account with this account number already exists." });
    }

    const activeBankCount = await SocietyFinancialAccount.count({
      where: { society_id: societyId, account_type: { [Op.ne]: "CASH" }, status: "ACTIVE" },
      transaction: t,
    });

    const makeDefault = Boolean(is_default) || activeBankCount === 0;
    if (makeDefault) {
      await SocietyFinancialAccount.update(
        { is_default: false },
        { where: { society_id: societyId }, transaction: t }
      );
    }

    const acc = await SocietyFinancialAccount.create(
      {
        society_id: societyId,
        account_name: account_name.trim(),
        account_type: rawType,
        bank_name: bank_name.trim(),
        account_holder_name: account_holder_name.trim(),
        account_number: cleanNum,
        ifsc_code: ifsc_code.trim().toUpperCase(),
        branch_name: branch_name ? branch_name.trim() : null,
        opening_balance: openBal,
        opening_balance_date: effDate,
        current_balance: openBal,
        is_default: makeDefault,
        status: "ACTIVE",
        created_by: req.user.id,
      },
      { transaction: t }
    );

    await ensureCashAccount(societyId, t);
    await markSocietyMultiAccount(societyId, effDate, t);

    await auditLog({
      societyId,
      action: "FINANCIAL_ACCOUNT_CREATE",
      entityType: "SocietyFinancialAccount",
      entityId: acc.id,
      newValue: formatAccount(acc),
      reason: `Added bank account ${acc.account_name} (${acc.bank_name}) with opening balance ₹${openBal.toFixed(2)}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: formatAccount(acc), message: "Bank account added." });
  } catch (err) {
    await t.rollback();
    console.error("[createAccount]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── UPDATE ACCOUNT ─────────────────────────────────────────────────────── */
const updateAccount = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const acc = await SocietyFinancialAccount.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!acc) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Financial account not found." });
    }

    const oldSnapshot = formatAccount(acc);
    const updates = {};

    if (req.body.account_name !== undefined && req.body.account_name.trim()) {
      updates.account_name = req.body.account_name.trim();
    }

    if (acc.account_type !== "CASH") {
      if (req.body.account_type && ["SAVINGS", "CURRENT", "OTHER"].includes(req.body.account_type.toUpperCase())) {
        updates.account_type = req.body.account_type.toUpperCase();
      }
      if (req.body.bank_name !== undefined) updates.bank_name = String(req.body.bank_name).trim();
      if (req.body.account_holder_name !== undefined) updates.account_holder_name = String(req.body.account_holder_name).trim();
      if (req.body.ifsc_code !== undefined) updates.ifsc_code = String(req.body.ifsc_code).trim().toUpperCase();
      if (req.body.branch_name !== undefined) updates.branch_name = req.body.branch_name ? String(req.body.branch_name).trim() : null;
      if (req.body.account_number !== undefined) {
        const cleanNum = String(req.body.account_number).trim();
        const dup = await SocietyFinancialAccount.findOne({
          where: { society_id: societyId, account_number: cleanNum, id: { [Op.ne]: acc.id } },
          transaction: t,
        });
        if (dup) {
          await t.rollback();
          return res.status(409).json({ success: false, message: "Another bank account already uses this account number." });
        }
        updates.account_number = cleanNum;
      }

      if (req.body.is_default === true) {
        if (acc.status !== "ACTIVE" && req.body.status !== "ACTIVE") {
          await t.rollback();
          return res.status(400).json({ success: false, message: "Only an active bank account can be set as default." });
        }
        await SocietyFinancialAccount.update(
          { is_default: false },
          { where: { society_id: societyId, id: { [Op.ne]: acc.id } }, transaction: t }
        );
        updates.is_default = true;
      }
    }

    if (req.body.opening_balance !== undefined) {
      const newOpen = Number(req.body.opening_balance);
      if (!Number.isFinite(newOpen) || newOpen < 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Opening balance must be non-negative." });
      }
      const delta = Math.round((newOpen - Number(acc.opening_balance || 0)) * 100) / 100;
      const nextCur = Math.round((Number(acc.current_balance || 0) + delta) * 100) / 100;
      if (nextCur < 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Adjusted opening balance would result in a negative current balance." });
      }
      updates.opening_balance = newOpen;
      updates.current_balance = nextCur;
      if (newOpen > 0) {
        await markSocietyMultiAccount(societyId, req.body.opening_balance_date || acc.opening_balance_date, t);
      }
    }

    if (req.body.opening_balance_date !== undefined) {
      updates.opening_balance_date = req.body.opening_balance_date || null;
    }

    await acc.update(updates, { transaction: t });

    await auditLog({
      societyId,
      action: "FINANCIAL_ACCOUNT_UPDATE",
      entityType: "SocietyFinancialAccount",
      entityId: acc.id,
      oldValue: oldSnapshot,
      newValue: formatAccount(acc),
      reason: req.body.reason || `Updated account ${acc.account_name}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: formatAccount(acc), message: "Account updated." });
  } catch (err) {
    await t.rollback();
    console.error("[updateAccount]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── TOGGLE STATUS ──────────────────────────────────────────────────────── */
const toggleAccountStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const acc = await SocietyFinancialAccount.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!acc) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    const nextStatus = req.body.status
      ? String(req.body.status).toUpperCase()
      : acc.status === "ACTIVE"
      ? "INACTIVE"
      : "ACTIVE";

    if (!["ACTIVE", "INACTIVE"].includes(nextStatus)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Status must be ACTIVE or INACTIVE." });
    }

    const updates = { status: nextStatus };
    if (nextStatus === "INACTIVE" && acc.is_default) {
      updates.is_default = false;
    }

    await acc.update(updates, { transaction: t });

    await auditLog({
      societyId,
      action: "FINANCIAL_ACCOUNT_STATUS",
      entityType: "SocietyFinancialAccount",
      entityId: acc.id,
      oldValue: { status: acc.status },
      newValue: { status: nextStatus },
      reason: `Account ${acc.account_name} marked ${nextStatus}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: formatAccount(acc), message: `Account marked ${nextStatus}.` });
  } catch (err) {
    await t.rollback();
    console.error("[toggleAccountStatus]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── RECORD CASH ENTRY (CASH_IN or ADJUSTMENT) ──────────────────────────── */
const recordCashEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society could not be resolved." });
    }

    const { type = "CREDIT", source = "CASH_IN", amount, entry_date, description } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Amount must be a positive number." });
    }
    if (!description || !String(description).trim()) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Description is required." });
    }

    const cleanType = String(type).toUpperCase();
    const cleanSource = String(source).toUpperCase();
    if (!["CREDIT", "DEBIT"].includes(cleanType) || !["CASH_IN", "ADJUSTMENT"].includes(cleanSource)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Invalid cash entry type or source." });
    }

    const cash = await ensureCashAccount(societyId, t);
    const lockedCash = await SocietyFinancialAccount.findByPk(cash.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (lockedCash.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Cash account is inactive." });
    }

    const txDate = entry_date || new Date().toISOString().slice(0, 10);
    if (lockedCash.opening_balance_date && txDate < lockedCash.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Transaction date cannot be before Cash Account opening balance date (${lockedCash.opening_balance_date}).`,
      });
    }

    if (cleanType === "DEBIT" && Number(lockedCash.current_balance) < amt) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient cash balance. Available: ₹${Number(lockedCash.current_balance).toFixed(2)}`,
      });
    }

    const entry = await createLedgerEntry({
      societyId,
      type: cleanType,
      source: cleanSource,
      referenceId: null,
      amount: amt,
      entryDate: txDate,
      description: String(description).trim(),
      financialAccountId: lockedCash.id,
      actor: req.user,
      transaction: t,
    });

    await auditLog({
      societyId,
      action: cleanSource === "CASH_IN" ? "CASH_IN_ENTRY" : "CASH_ADJUSTMENT",
      entityType: "LedgerEntry",
      entityId: entry.id,
      newValue: { type: cleanType, source: cleanSource, amount: amt, entry_date: txDate, description },
      reason: String(description).trim(),
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: entry, message: "Cash entry recorded." });
  } catch (err) {
    await t.rollback();
    console.error("[recordCashEntry]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── TRANSFER BETWEEN ACCOUNTS (CASH <-> BANK / BANK <-> BANK) ──────────── */
const transferBetweenAccounts = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const { from_account_id, to_account_id, amount, transfer_date, description } = req.body;
    const fromId = parseInt(from_account_id, 10);
    const toId = parseInt(to_account_id, 10);
    const amt = Number(amount);

    if (!fromId || !toId || fromId === toId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Select two distinct valid accounts." });
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Transfer amount must be positive." });
    }

    // Lock in deterministic order to avoid deadlocks
    const firstId = Math.min(fromId, toId);
    const secondId = Math.max(fromId, toId);
    const firstAcc = await SocietyFinancialAccount.findOne({
      where: { id: firstId, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const secondAcc = await SocietyFinancialAccount.findOne({
      where: { id: secondId, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const fromAcc = firstId === fromId ? firstAcc : secondAcc;
    const toAcc = firstId === toId ? firstAcc : secondAcc;

    if (!fromAcc || !toAcc) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "One or both accounts not found for this society." });
    }
    if (fromAcc.status !== "ACTIVE" || toAcc.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Both source and destination accounts must be ACTIVE." });
    }
    if (Number(fromAcc.current_balance) < amt) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in ${fromAcc.account_name}. Available: ₹${Number(fromAcc.current_balance).toFixed(2)}`,
      });
    }

    const txDate = transfer_date || new Date().toISOString().slice(0, 10);
    if (fromAcc.opening_balance_date && txDate < fromAcc.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Transfer date precedes ${fromAcc.account_name} opening date.` });
    }
    if (toAcc.opening_balance_date && txDate < toAcc.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Transfer date precedes ${toAcc.account_name} opening date.` });
    }

    const transferRef = Number(`${Date.now()}`.slice(-9));
    const descText = (description || "").trim() || `Transfer: ${fromAcc.account_name} → ${toAcc.account_name}`;

    const debitEntry = await createLedgerEntry({
      societyId,
      type: "DEBIT",
      source: "ACCOUNT_TRANSFER",
      referenceId: transferRef,
      amount: amt,
      entryDate: txDate,
      description: descText,
      financialAccountId: fromAcc.id,
      actor: req.user,
      transaction: t,
    });

    const creditEntry = await createLedgerEntry({
      societyId,
      type: "CREDIT",
      source: "ACCOUNT_TRANSFER",
      referenceId: transferRef,
      amount: amt,
      entryDate: txDate,
      description: descText,
      financialAccountId: toAcc.id,
      actor: req.user,
      transaction: t,
    });

    await auditLog({
      societyId,
      action: "ACCOUNT_TRANSFER",
      entityType: "SocietyFinancialAccount",
      entityId: fromAcc.id,
      oldValue: { from: fromAcc.account_name, to: toAcc.account_name },
      newValue: { amount: amt, transfer_date: txDate, transfer_ref: transferRef },
      reason: descText,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({
      success: true,
      message: "Transfer completed.",
      data: { transfer_ref: transferRef, debit: debitEntry, credit: creditEntry },
    });
  } catch (err) {
    await t.rollback();
    console.error("[transferBetweenAccounts]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── RECONCILE ACCOUNTS ─────────────────────────────────────────────────── */
const reconcileAccounts = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const accounts = await SocietyFinancialAccount.findAll({
      where: { society_id: societyId },
      order: [["id", "ASC"]],
    });

    const results = await Promise.all(
      accounts.map(async (acc) => {
        const dateFilter = acc.opening_balance_date ? "AND entry_date >= ?" : "";
        const replacements = acc.opening_balance_date
          ? [societyId, acc.id, acc.opening_balance_date]
          : [societyId, acc.id];
        const [rows] = await sequelize.query(
          `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS net_ledger
           FROM ledger_entries
           WHERE society_id = ? AND financial_account_id = ? ${dateFilter}`,
          { replacements }
        );
        const expected = Math.round((Number(acc.opening_balance || 0) + Number(rows[0]?.net_ledger || 0)) * 100) / 100;
        const stored = Math.round(Number(acc.current_balance || 0) * 100) / 100;
        return {
          id: acc.id,
          account_name: acc.account_name,
          account_type: acc.account_type,
          opening_balance: Number(acc.opening_balance || 0),
          stored_balance: stored,
          ledger_expected_balance: expected,
          variance: Math.round((stored - expected) * 100) / 100,
          is_reconciled: Math.abs(stored - expected) < 0.01,
        };
      })
    );

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error("[reconcileAccounts]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  toggleAccountStatus,
  recordCashEntry,
  transferBetweenAccounts,
  reconcileAccounts,
  formatAccount,
  maskAccountNumber,
};
