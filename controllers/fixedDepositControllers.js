const { Op } = require("sequelize");
const {
  sequelize,
  FixedDeposit,
  FixedDepositTransaction,
  SocietyFinancialAccount,
  LedgerEntry,
} = require("../models");
const {
  createLedgerEntry,
  auditLog,
  ensureCashAccount,
} = require("../utils/ledgerService");
const { formatAccount } = require("./financialAccountControllers");

function resolveSocietyId(req) {
  if (req.user.activeRole === "SUPER_ADMIN") {
    return parseInt(req.headers["x-society-id"] || req.query.society_id || req.body?.society_id, 10) || req.user.society_id;
  }
  return req.user.society_id;
}

const listFixedDeposits = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const where = { society_id: societyId };
    if (req.query.status && ["ACTIVE", "MATURED", "CLOSED", "PREMATURE_CLOSED"].includes(req.query.status.toUpperCase())) {
      where.status = req.query.status.toUpperCase();
    }
    if (req.query.fd_type && ["EXISTING", "NEW"].includes(req.query.fd_type.toUpperCase())) {
      where.fd_type = req.query.fd_type.toUpperCase();
    }
    if (req.query.financial_account_id && req.query.financial_account_id !== "ALL") {
      const accId = parseInt(req.query.financial_account_id, 10);
      if (Number.isInteger(accId) && accId > 0) {
        where[Op.or] = [{ funding_account_id: accId }, { receiving_account_id: accId }];
      }
    }

    const rows = await FixedDeposit.findAll({
      where,
      include: [
        {
          model: SocietyFinancialAccount,
          as: "fundingAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number"],
        },
        {
          model: SocietyFinancialAccount,
          as: "receivingAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number"],
        },
      ],
      order: [["maturity_date", "ASC"], ["id", "DESC"]],
    });

    const allFds = await FixedDeposit.findAll({ where: { society_id: societyId } });
    const summary = {
      active_principal: Math.round(
        allFds.filter((f) => f.status === "ACTIVE").reduce((s, f) => s + Number(f.principal_amount || 0), 0) * 100
      ) / 100,
      active_count: allFds.filter((f) => f.status === "ACTIVE").length,
      existing_count: allFds.filter((f) => f.fd_type === "EXISTING").length,
      new_count: allFds.filter((f) => f.fd_type === "NEW").length,
      matured_count: allFds.filter((f) => ["MATURED", "CLOSED", "PREMATURE_CLOSED"].includes(f.status)).length,
      total_interest_earned: Math.round(
        allFds.reduce((s, f) => s + Number(f.total_interest_earned ?? f.total_interest_paid ?? 0), 0) * 100
      ) / 100,
      total_loss: Math.round(allFds.reduce((s, f) => s + Number(f.loss_amount || 0), 0) * 100) / 100,
    };

    const data = rows.map((r) => {
      const j = r.toJSON();
      if (j.fundingAccount) j.fundingAccount = formatAccount(j.fundingAccount);
      if (j.receivingAccount) j.receivingAccount = formatAccount(j.receivingAccount);
      return j;
    });

    return res.json({ success: true, data, summary });
  } catch (err) {
    console.error("[listFixedDeposits]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getFixedDepositDetail = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    const fd = await FixedDeposit.findOne({
      where: { id: req.params.id, society_id: societyId },
      include: [
        { model: SocietyFinancialAccount, as: "fundingAccount", required: false },
        { model: SocietyFinancialAccount, as: "receivingAccount", required: false },
        {
          model: FixedDepositTransaction,
          as: "transactions",
          include: [
            { model: SocietyFinancialAccount, as: "financialAccount", required: false, attributes: ["id", "account_name", "account_type", "bank_name"] },
            { model: LedgerEntry, as: "ledgerEntries", required: false, attributes: ["id", "type", "source", "amount", "entry_date", "status"] },
          ],
        },
      ],
      order: [[{ model: FixedDepositTransaction, as: "transactions" }, "transaction_date", "DESC"], [{ model: FixedDepositTransaction, as: "transactions" }, "id", "DESC"]],
    });
    if (!fd) return res.status(404).json({ success: false, message: "Fixed deposit not found." });

    const data = fd.toJSON();
    if (data.fundingAccount) data.fundingAccount = formatAccount(data.fundingAccount);
    if (data.receivingAccount) data.receivingAccount = formatAccount(data.receivingAccount);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[getFixedDepositDetail]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createFixedDeposit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society could not be resolved." });
    }

    const {
      fd_type = "NEW",
      funding_source,
      funding_account_id,
      fd_number,
      bank_name,
      principal_amount,
      interest_rate,
      start_date,
      maturity_date,
      expected_maturity_amount,
      interest_payout_type = "ON_MATURITY",
      remarks,
    } = req.body;

    const cleanFdType = String(fd_type).toUpperCase();
    if (!["EXISTING", "NEW"].includes(cleanFdType)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "fd_type must be EXISTING or NEW." });
    }

    const cleanFdNum = String(fd_number || "").trim();
    const principal = Number(principal_amount);
    const rate = Number(interest_rate);
    const expectedMat = expected_maturity_amount !== undefined && expected_maturity_amount !== ""
      ? Number(expected_maturity_amount)
      : principal;

    if (!cleanFdNum || !start_date || !maturity_date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "fd_number, start_date, and maturity_date are required." });
    }
    if (!Number.isFinite(principal) || principal <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "principal_amount must be a positive number." });
    }
    if (!Number.isFinite(rate) || rate < 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "interest_rate must be non-negative." });
    }
    if (maturity_date < start_date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "maturity_date cannot be earlier than start_date." });
    }

    const dup = await FixedDeposit.findOne({
      where: { society_id: societyId, fd_number: cleanFdNum },
      transaction: t,
    });
    if (dup) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "An FD with this FD number already exists." });
    }

    let resolvedBankName = bank_name ? String(bank_name).trim() : "";
    let resolvedFundingSource = null;
    let fundingAcc = null;

    if (cleanFdType === "EXISTING") {
      if (!resolvedBankName) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "bank_name is required for an Existing FD." });
      }
    } else {
      // NEW FD: must debit selected BANK or CASH account
      resolvedFundingSource = String(funding_source || "").toUpperCase();
      if (!["BANK", "CASH"].includes(resolvedFundingSource)) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "funding_source must be BANK or CASH for a New FD." });
      }

      if (resolvedFundingSource === "CASH") {
        const cash = await ensureCashAccount(societyId, t);
        fundingAcc = await SocietyFinancialAccount.findByPk(cash.id, { transaction: t, lock: t.LOCK.UPDATE });
      } else {
        const accId = parseInt(funding_account_id, 10);
        if (!Number.isInteger(accId) || accId <= 0) {
          await t.rollback();
          return res.status(400).json({ success: false, message: "Select an active Bank Account to fund this FD." });
        }
        fundingAcc = await SocietyFinancialAccount.findOne({
          where: { id: accId, society_id: societyId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      if (!fundingAcc || fundingAcc.status !== "ACTIVE") {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Selected funding account is not found or inactive." });
      }
      if (resolvedFundingSource === "BANK" && fundingAcc.account_type === "CASH") {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Please select a Bank Account, not Cash." });
      }
      if (fundingAcc.opening_balance_date && start_date < fundingAcc.opening_balance_date) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `FD start date cannot precede ${fundingAcc.account_name} opening date (${fundingAcc.opening_balance_date}).`,
        });
      }
      if (Number(fundingAcc.current_balance) < principal) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient balance in ${fundingAcc.account_name}. Available: ₹${Number(fundingAcc.current_balance).toFixed(2)}`,
        });
      }
      if (!resolvedBankName) {
        resolvedBankName = fundingAcc.bank_name || fundingAcc.account_name;
      }
    }

    const fd = await FixedDeposit.create(
      {
        society_id: societyId,
        fd_type: cleanFdType,
        funding_source: resolvedFundingSource,
        funding_account_id: fundingAcc ? fundingAcc.id : null,
        fd_number: cleanFdNum,
        bank_name: resolvedBankName,
        principal_amount: principal,
        interest_rate: rate,
        start_date,
        maturity_date,
        expected_maturity_amount: Number.isFinite(expectedMat) ? expectedMat : principal,
        total_interest_paid: 0,
        loss_amount: 0,
        interest_payout_type,
        status: "ACTIVE",
        remarks: remarks ? String(remarks).trim() : null,
        created_by: req.user.id,
      },
      { transaction: t }
    );

    const fdTxn = await FixedDepositTransaction.create(
      {
        society_id: societyId,
        fixed_deposit_id: fd.id,
        transaction_type: cleanFdType === "EXISTING" ? "EXISTING_REGISTER" : "NEW_FUNDING",
        transaction_date: start_date,
        transaction_amount: cleanFdType === "EXISTING" ? 0 : principal,
        principal_amount: principal,
        interest_amount: 0,
        loss_amount: 0,
        financial_account_id: fundingAcc ? fundingAcc.id : null,
        reference_no: cleanFdNum,
        remarks: remarks ? String(remarks).trim() : null,
        created_by: req.user.id,
      },
      { transaction: t }
    );

    if (cleanFdType === "NEW" && fundingAcc) {
      await createLedgerEntry({
        societyId,
        type: "DEBIT",
        source: "FD_TRANSFER",
        referenceId: fd.id,
        amount: principal,
        entryDate: start_date,
        description: `Fixed Deposit #${cleanFdNum} opened at ${resolvedBankName} from ${fundingAcc.account_name}`,
        financialAccountId: fundingAcc.id,
        fdTransactionId: fdTxn.id,
        actor: req.user,
        transaction: t,
      });
    }

    await auditLog({
      societyId,
      action: cleanFdType === "EXISTING" ? "FD_EXISTING_REGISTER" : "FD_NEW_CREATE",
      entityType: "FixedDeposit",
      entityId: fd.id,
      newValue: fd.toJSON(),
      reason:
        cleanFdType === "EXISTING"
          ? `Registered existing FD ${cleanFdNum} (${resolvedBankName}) for ₹${principal.toFixed(2)} (no liquid deduction)`
          : `Created new FD ${cleanFdNum} (${resolvedBankName}) for ₹${principal.toFixed(2)} from ${fundingAcc.account_name}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: fd, message: "Fixed deposit recorded." });
  } catch (err) {
    await t.rollback();
    console.error("[createFixedDeposit]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateFixedDeposit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const fd = await FixedDeposit.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!fd) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Fixed deposit not found." });
    }
    if (fd.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Only ACTIVE fixed deposits can be edited." });
    }

    const oldVal = fd.toJSON();
    const updates = {};
    if (req.body.bank_name !== undefined && fd.fd_type === "EXISTING") {
      updates.bank_name = String(req.body.bank_name).trim();
    }
    if (req.body.interest_rate !== undefined) updates.interest_rate = Number(req.body.interest_rate);
    if (req.body.maturity_date !== undefined) updates.maturity_date = req.body.maturity_date;
    if (req.body.expected_maturity_amount !== undefined) updates.expected_maturity_amount = Number(req.body.expected_maturity_amount);
    if (req.body.interest_payout_type !== undefined) updates.interest_payout_type = req.body.interest_payout_type;
    if (req.body.remarks !== undefined) updates.remarks = req.body.remarks ? String(req.body.remarks).trim() : null;

    await fd.update(updates, { transaction: t });

    await auditLog({
      societyId,
      action: "FD_UPDATE",
      entityType: "FixedDeposit",
      entityId: fd.id,
      oldValue: oldVal,
      newValue: fd.toJSON(),
      reason: `Updated FD ${fd.fd_number}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: fd, message: "Fixed deposit updated." });
  } catch (err) {
    await t.rollback();
    console.error("[updateFixedDeposit]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const recordInterestPayout = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const fd = await FixedDeposit.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!fd) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Fixed deposit not found." });
    }
    if (fd.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Interest payout can only be recorded for ACTIVE FDs." });
    }
    if (["ON_MATURITY", "CUMULATIVE"].includes(fd.interest_payout_type)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Periodic interest payouts apply only to Monthly, Quarterly, or Yearly payout FDs. Use Mature / Close for On Maturity FDs.",
      });
    }

    const { interest_amount, receiving_account_id, payout_date, reference_no, remarks } = req.body;
    const intAmt = Number(interest_amount);
    if (!Number.isFinite(intAmt) || intAmt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "interest_amount must be a positive number." });
    }

    const recAcc = await SocietyFinancialAccount.findOne({
      where: { id: parseInt(receiving_account_id, 10), society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!recAcc || recAcc.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Select an active Bank or Cash account to receive interest." });
    }

    const txDate = payout_date || new Date().toISOString().slice(0, 10);
    if (recAcc.opening_balance_date && txDate < recAcc.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Payout date cannot precede ${recAcc.account_name} opening date.`,
      });
    }

    const fdTxn = await FixedDepositTransaction.create(
      {
        society_id: societyId,
        fixed_deposit_id: fd.id,
        transaction_type: "INTEREST_PAYOUT",
        transaction_date: txDate,
        transaction_amount: intAmt,
        principal_amount: 0,
        interest_amount: intAmt,
        loss_amount: 0,
        financial_account_id: recAcc.id,
        reference_no: reference_no ? String(reference_no).trim() : null,
        remarks: remarks ? String(remarks).trim() : null,
        created_by: req.user.id,
      },
      { transaction: t }
    );

    await createLedgerEntry({
      societyId,
      type: "CREDIT",
      source: "FD_INTEREST",
      referenceId: null,
      amount: intAmt,
      entryDate: txDate,
      description: `Interest received on FD #${fd.fd_number} (${fd.bank_name || "Bank"}) into ${recAcc.account_name}`,
      financialAccountId: recAcc.id,
      fdTransactionId: fdTxn.id,
      actor: req.user,
      transaction: t,
    });

    const newPaidInt = Math.round((Number(fd.total_interest_paid || 0) + intAmt) * 100) / 100;
    await fd.update({ total_interest_paid: newPaidInt }, { transaction: t });

    await auditLog({
      societyId,
      action: "FD_INTEREST_PAYOUT",
      entityType: "FixedDeposit",
      entityId: fd.id,
      newValue: { interest_amount: intAmt, receiving_account_id: recAcc.id, payout_date: txDate },
      reason: `Recorded FD ${fd.fd_number} interest payout of ₹${intAmt.toFixed(2)} into ${recAcc.account_name}`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: { fd, transaction: fdTxn }, message: "Interest payout recorded." });
  } catch (err) {
    await t.rollback();
    console.error("[recordInterestPayout]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const closeOrMatureFixedDeposit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const fd = await FixedDeposit.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!fd) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Fixed deposit not found." });
    }
    if (fd.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "This fixed deposit is already matured or closed." });
    }

    const {
      closure_type = "MATURITY",
      receiving_account_id,
      closed_date,
      principal_returned,
      final_interest_received = 0,
      reference_no,
      remarks,
    } = req.body;

    const cleanClosure = String(closure_type).toUpperCase();
    if (!["MATURITY", "PREMATURE_CLOSURE"].includes(cleanClosure)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "closure_type must be MATURITY or PREMATURE_CLOSURE." });
    }

    const origPrincipal = Number(fd.principal_amount);
    const pReturned = principal_returned !== undefined ? Number(principal_returned) : origPrincipal;
    const fInterest = Number(final_interest_received || 0);

    if (!Number.isFinite(pReturned) || pReturned < 0 || pReturned > origPrincipal) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `principal_returned must be between 0 and original principal (₹${origPrincipal.toFixed(2)}).`,
      });
    }
    if (!Number.isFinite(fInterest) || fInterest < 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "final_interest_received must be non-negative." });
    }

    const txAmount = Math.round((pReturned + fInterest) * 100) / 100;
    if (txAmount <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Total received amount must be greater than zero." });
    }

    const lossAmount = Math.round(Math.max(0, origPrincipal - pReturned) * 100) / 100;
    const totalInterestEarned = Math.round((Number(fd.total_interest_paid || 0) + fInterest) * 100) / 100;

    const recAcc = await SocietyFinancialAccount.findOne({
      where: { id: parseInt(receiving_account_id, 10), society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!recAcc || recAcc.status !== "ACTIVE") {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Select an active Bank or Cash account to receive the payout." });
    }

    const txDate = closed_date || new Date().toISOString().slice(0, 10);
    if (recAcc.opening_balance_date && txDate < recAcc.opening_balance_date) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Closure date cannot precede ${recAcc.account_name} opening date.`,
      });
    }

    const fdTxn = await FixedDepositTransaction.create(
      {
        society_id: societyId,
        fixed_deposit_id: fd.id,
        transaction_type: cleanClosure,
        transaction_date: txDate,
        transaction_amount: txAmount,
        principal_amount: pReturned,
        interest_amount: fInterest,
        loss_amount: lossAmount,
        financial_account_id: recAcc.id,
        reference_no: reference_no ? String(reference_no).trim() : null,
        remarks: remarks ? String(remarks).trim() : null,
        created_by: req.user.id,
      },
      { transaction: t }
    );

    if (pReturned > 0) {
      await createLedgerEntry({
        societyId,
        type: "CREDIT",
        source: "FD_MATURITY",
        referenceId: fd.id,
        amount: pReturned,
        entryDate: txDate,
        description: `FD #${fd.fd_number} ${cleanClosure === "PREMATURE_CLOSURE" ? "prematurely closed" : "matured"} — principal credited to ${recAcc.account_name}`,
        financialAccountId: recAcc.id,
        fdTransactionId: fdTxn.id,
        actor: req.user,
        transaction: t,
      });
    }

    if (fInterest > 0) {
      await createLedgerEntry({
        societyId,
        type: "CREDIT",
        source: "FD_INTEREST",
        referenceId: fd.id,
        amount: fInterest,
        entryDate: txDate,
        description: `Interest received on closure of FD #${fd.fd_number} into ${recAcc.account_name}`,
        financialAccountId: recAcc.id,
        fdTransactionId: fdTxn.id,
        actor: req.user,
        transaction: t,
      });
    }

    const nextStatus = cleanClosure === "PREMATURE_CLOSURE" ? "PREMATURE_CLOSED" : "MATURED";
    await fd.update(
      {
        status: nextStatus,
        receiving_account_id: recAcc.id,
        closed_date: txDate,
        principal_returned: pReturned,
        final_interest_received: fInterest,
        total_interest_earned: totalInterestEarned,
        loss_amount: lossAmount,
        actual_received_amount: txAmount,
        remarks: remarks ? String(remarks).trim() : fd.remarks,
      },
      { transaction: t }
    );

    await auditLog({
      societyId,
      action: cleanClosure === "PREMATURE_CLOSURE" ? "FD_PREMATURE_CLOSE" : "FD_MATURE",
      entityType: "FixedDeposit",
      entityId: fd.id,
      newValue: {
        status: nextStatus,
        transaction_amount: txAmount,
        principal_returned: pReturned,
        final_interest_received: fInterest,
        loss_amount: lossAmount,
        receiving_account_id: recAcc.id,
      },
      reason: `Closed FD ${fd.fd_number} (${nextStatus}): Received ₹${txAmount.toFixed(2)} (Principal ₹${pReturned.toFixed(2)}, Interest ₹${fInterest.toFixed(2)}, Loss ₹${lossAmount.toFixed(2)})`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: { fd, transaction: fdTxn }, message: "Fixed deposit closed." });
  } catch (err) {
    await t.rollback();
    console.error("[closeOrMatureFixedDeposit]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  listFixedDeposits,
  getFixedDepositDetail,
  createFixedDeposit,
  updateFixedDeposit,
  recordInterestPayout,
  closeOrMatureFixedDeposit,
};
