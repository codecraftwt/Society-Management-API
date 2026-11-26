const { User, Block, HouseHoldMember, Society, FlatMembership, SocietyFinancialAccount } = require("../models");
const { getUserOwnedFlatIds, getUserAuthorizedFlatIds } = require("../utils/accessHelpers");

const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Floor = require("../models/Floor");
const UserSetting = require("../models/UserSetting");
const Payment = require("../models/Payment");
const BillLateFeeWaiver = require("../models/BillLateFeeWaiver");
const { sendPushNotification } = require("../utils/pushNotification");
const { createLedgerEntry, ensureCashAccount, getDefaultBankAccount } = require("../utils/ledgerService");
const { calculateLateFee, buildBillLateFeeFields } = require("../utils/lateFeeHelper");
const sequelize = require("../config/db");
const notificationService = require("../services/notificationService");

const { Op } = require("sequelize");

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ═══════════════════════════════════════
   BILL TENANT SCOPE RESOLVER (shared)
   Bills have no society_id column, so society is derived through
   Flat → Block.society_id. A SUPER_ADMIN may look across all societies or
   narrow to one via x-society-id / ?society_id. EVERY other role is
   hard-pinned to req.user.society_id — a client-supplied society_id can never
   widen their scope (previously getSocietyBills and confirmPayment used
   `header || query || user.society_id` for any role).
   ═══════════════════════════════════════ */
const resolveBillScope = (req) => {
  if (req.user?.activeRole === "SUPER_ADMIN") {
    const raw = req.headers["x-society-id"] ||
      (req.query?.society_id && req.query.society_id !== "ALL" ? req.query.society_id : null);
    const id = parseInt(raw, 10);
    return { isSuperAdmin: true, societyId: Number.isInteger(id) && id > 0 ? id : null };
  }
  const own = parseInt(req.user?.society_id, 10);
  return { isSuperAdmin: false, societyId: Number.isInteger(own) && own > 0 ? own : null };
};

/* Assert a single bill belongs to an authorized society. Returns true if the
   caller may act on it. Global super admins are unrestricted. */
const billInScope = (scope, bill) => {
  if (scope.isSuperAdmin && scope.societyId === null) return true;
  const billSociety = parseInt(bill?.society_id || bill?.Flat?.Block?.society_id, 10);
  return scope.societyId !== null && Number.isInteger(billSociety) && billSociety === scope.societyId;
};

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
      last_pay_date,
      financial_account_id
    } = req.body;

    const resolveCollectionBank = async (socId) => {
      if (!socId) return null;
      if (financial_account_id) {
        const chosen = await SocietyFinancialAccount.findOne({
          where: {
            id: parseInt(financial_account_id, 10),
            society_id: socId,
            status: "ACTIVE",
            account_type: { [Op.ne]: "CASH" },
          },
        });
        if (!chosen) {
          throw Object.assign(new Error("Selected collection bank account is invalid or inactive."), { statusCode: 400 });
        }
        return chosen;
      }
      return getDefaultBankAccount(socId);
    };

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

      const flat = await Flat.findByPk(flat_id, {
        include: [{ model: Block, attributes: ["society_id"] }],
      });

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

      const billSocId = req.user?.society_id || flat?.Block?.society_id || null;
      let collectionBank = null;
      try {
        collectionBank = await resolveCollectionBank(billSocId);
      } catch (bankErr) {
        return res.status(bankErr.statusCode || 400).json({ message: bankErr.message });
      }
      const bill = await Bill.create({
        society_id: billSocId,
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
        financial_account_id: collectionBank?.id || null,
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
          await notificationService.sendNotification({
            societyId: req.user.society_id,
            receiverUserId: user.id,
            title: "Bill Payment Pending",
            message: `⚡ Your ${title} bill of ₹${amount} is waiting for payment`,
            type: "BILL",
            actionType: "BILL_PAYMENT",
            actionRoute: "/resident/bills",
            fcmToken: user.fcm_token,
            sourceEventId: `BILL:${bill.id}:${user.id}`,
            extraData: {
              route: "/resident/bills",
              billId: bill.id.toString(),
            },
          });
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
      let collectionBank = null;
      try {
        collectionBank = await resolveCollectionBank(req.user.society_id);
      } catch (bankErr) {
        return res.status(bankErr.statusCode || 400).json({ message: bankErr.message });
      }

      for (let flat of flats) {
        const activeMember = flat.FlatMemberships?.find(m => m.is_current) || flat.FlatMemberships?.[0];
        const residentId = activeMember?.user_id || flat.resident_id;

        if (!residentId) continue;

        const bill = await Bill.create({
          society_id: req.user.society_id,
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
          financial_account_id: collectionBank?.id || null,
        });

        createdBills.push(bill);

        const user = activeMember?.User || (residentId ? await User.findByPk(residentId, { attributes: ["id", "fcm_token"] }) : null);
        const settings = residentId ? await UserSetting.findOne({ where: { user_id: residentId } }) : null;

        if (!settings || settings.payment_updates !== false) {
          await notificationService.sendNotification({
            societyId: req.user.society_id,
            receiverUserId: residentId,
            receiverRole: "RESIDENT",
            title: "Bill Payment Pending",
            message: `⚡ Your ${title} bill of ₹${amount} is waiting for payment`,
            type: "BILL",
            actionType: "BILL_PAYMENT",
            actionRoute: "/resident/bills",
            fcmToken: user?.fcm_token,
            sourceEventId: `BILL:${bill.id}:${residentId}`,
            extraData: {
              route: "/resident/bills",
              billId: bill.id.toString(),
            },
          });
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

    // ── Society scope (non-super-admins are hard-pinned to their own society) ──
    const scope = resolveBillScope(req);
    if (!scope.isSuperAdmin && scope.societyId === null) {
      return res.status(403).json({ message: "Your account is not scoped to a society." });
    }
    const isGlobalSuperAdmin = scope.isSuperAdmin && scope.societyId === null;
    const targetSocId = scope.societyId;

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
      attributes: ["id", "flat_number", "floor_id", "block_id", "resident_id"],
      include: [
        { model: Block, required: false, attributes: ["id", "name"], include: [{ model: Society, attributes: ["id", "name"] }] },
        { model: Floor, required: false, attributes: ["id", "floor_number"], include: [{ model: Block, required: false, attributes: ["id", "name"] }] },
        {
          model: FlatMembership,
          required: false,
          where: { is_current: true },
          include: [{ model: User, required: false, attributes: ["id", "name", "email", "phone"] }],
        },
        {
          // Directly-assigned resident on the flat (legacy resident_id) — used
          // as a fallback when the flat has no active FlatMembership row so the
          // UI never shows "Unassigned" for a genuinely occupied flat.
          model: User,
          required: false,
          attributes: ["id", "name", "email", "phone"],
        },
      ],
    };

    const paymentInclude = {
      model: Payment,
      required: false,
      attributes: ["id", "amount", "base_amount", "late_fee_amount", "waived_amount", "payment_mode", "payment_date", "confirmed_at", "source", "status", "resident_id"],
      include: [
        {
          model: User,
          as: "resident",
          required: false,
          attributes: ["id", "name", "email", "phone"],
        },
      ],
    };

    const waiverInclude = {
      model: BillLateFeeWaiver,
      as: "lateFeeWaivers",
      required: false,
      attributes: ["id", "waiver_amount", "reason", "waived_by", "created_at"],
    };

    // ── Paginated query ──
    const { count, rows: bills } = await Bill.findAndCountAll({
      where:    billWhere,
      include:  [flatInclude, paymentInclude, waiverInclude],
      order:    [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
      col:      "id",
    });

    // ── Unfiltered counts for stat strip & tab badges ──
    const allBillsForCounts = await Bill.findAll({
      attributes: ["id", "status", "amount", "due_date", "last_pay_date", "late_fee_enabled", "late_fee_type", "late_fee_value", "late_fee_grace_days", "late_fee_max_amount"],
      where: targetFlatIds !== null ? { flat_id: { [Op.in]: targetFlatIds } } : {},
      include: [
        { model: BillLateFeeWaiver, as: "lateFeeWaivers", required: false, attributes: ["waiver_amount"] },
        { model: Payment, required: false, attributes: ["amount", "late_fee_amount", "waived_amount", "status"] },
      ],
    });

    const totalAll                 = allBillsForCounts.length;
    const totalPaid                = allBillsForCounts.filter(b => b.status === "PAID").length;
    const totalPending             = allBillsForCounts.filter(b => b.status === "PENDING").length;
    const totalPendingVerification = allBillsForCounts.filter(b => b.status === "PENDING_VERIFICATION").length;
    const totalRevenue             = allBillsForCounts
      .filter(b => b.status === "PAID")
      .reduce((s, b) => {
        const settled = (b.Payments || []).find((p) => p.status === "SUCCESS");
        return s + Number(settled?.amount ?? b.amount ?? 0);
      }, 0);
    const totalPendingAmount       = allBillsForCounts
      .filter(b => b.status !== "PAID")
      .reduce((s, b) => s + calculateLateFee(b, { waivers: b.lateFeeWaivers || [] }).totalPayable, 0);
    const totalAllAmount           = totalRevenue + totalPendingAmount;

    const formattedBills = bills.map((bill) => {
      const b = bill.toJSON ? bill.toJSON() : bill;
      const settledPayment = (b.Payments || []).find((p) => p.status === "SUCCESS") || null;
      if (b.Flat) {
        const activeMember = b.Flat.FlatMemberships?.find((m) => m.is_current) || b.Flat.FlatMemberships?.[0];
        // Prefer the active membership's user; fall back to the flat's directly
        // assigned resident (Flat.User via resident_id) so occupied flats
        // without a FlatMembership row are not shown as "Unassigned".
        b.Flat.User = activeMember?.User || b.Flat.User || null;
        if (!b.User) {
          b.User = b.Flat.User || null;
        }
      }
      return {
        ...b,
        ...buildBillLateFeeFields(b, { waivers: b.lateFeeWaivers || [], settledPayment }),
      };
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

    // Resolve only the flats this user holds in the ACTIVE society, so bills
    // from their other societies never leak into this panel.
    const activeSocietyId = parseInt(req.user?.society_id, 10);
    const myFlatIds = await getUserAuthorizedFlatIds(
      userId,
      Number.isInteger(activeSocietyId) && activeSocietyId > 0 ? activeSocietyId : null
    );

    // ── Pagination ──
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 10);
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
        {
          model: BillLateFeeWaiver,
          as: "lateFeeWaivers",
          required: false,
          attributes: ["id", "waiver_amount", "reason", "waived_by", "created_at"],
        },
        {
          model: Payment,
          required: false,
          attributes: ["id", "amount", "base_amount", "late_fee_amount", "waived_amount", "payment_mode", "payment_date", "confirmed_at", "status"],
        },
      ],
      order:  [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
      col: "id",
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
      attributes: ["id", "amount", "due_date", "last_pay_date", "status", "late_fee_enabled", "late_fee_type", "late_fee_value", "late_fee_grace_days", "late_fee_max_amount"],
      include: [{ model: BillLateFeeWaiver, as: "lateFeeWaivers", required: false, attributes: ["waiver_amount"] }],
    });
    const totalDue = pendingUnpaidBills.reduce(
      (sum, b) => sum + calculateLateFee(b, { waivers: b.lateFeeWaivers || [] }).totalPayable,
      0
    );

    const enrichedBills = bills.map((bill) => {
      const plain = bill.toJSON ? bill.toJSON() : bill;
      const settledPayment = (plain.Payments || []).find((p) => p.status === "SUCCESS") || null;
      return {
        ...plain,
        ...buildBillLateFeeFields(plain, {
          waivers: plain.lateFeeWaivers || [],
          settledPayment,
        }),
      };
    });

    res.status(200).json({
      data: enrichedBills,
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

    const bill = await Bill.findByPk(id, {
      include: [{ model: Flat, include: [{ model: Block }] }],
    });

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (!billInScope(resolveBillScope(req), bill)) {
      return res.status(403).json({ message: "You are not authorized to delete this bill." });
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
const processConfirmSingleBill = async (bill, reqUser, targetSocietyId, overrides = {}) => {
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
      const ownerMembership = locked.flat_id
        ? await FlatMembership.findOne({
            where: { flat_id: locked.flat_id, role: "OWNER", is_current: true },
            include: [{ model: User, attributes: ["id", "name"] }],
            transaction: t,
          })
        : null;
      const residentId = ownerMembership?.user_id || locked.resident_id || locked.Flat?.resident_id || undefined;
      const source = locked.type === "MAINTENANCE" ? "MAINTENANCE" : "BILL";

      // 0. Compute authoritative late fee breakdown inside transaction.
      const waivers = await BillLateFeeWaiver.findAll({
        where: { bill_id: locked.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const feeCalc = calculateLateFee(locked, { waivers });

      // 1. Mark the Payment as SUCCESS (create if missing for full audit).
      const payment = await Payment.findOne({
        where: { bill_id: locked.id },
        order: [["id", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const resolvedMode = overrides.payment_mode
        ? String(overrides.payment_mode).toUpperCase()
        : payment?.payment_mode || "UPI";

      let resolvedAccountId = null;
      if (resolvedMode === "CASH") {
        const cashAcc = await ensureCashAccount(societyId, t);
        resolvedAccountId = cashAcc?.id || null;
      } else {
        resolvedAccountId =
          (overrides.financial_account_id ? parseInt(overrides.financial_account_id, 10) : null) ||
          payment?.financial_account_id ||
          locked.financial_account_id ||
          (await getDefaultBankAccount(societyId, t))?.id ||
          null;
      }

      let finalCollectedAmount = feeCalc.totalPayable;
      let finalLateFeeAmount = feeCalc.outstandingLateFee;
      let finalWaivedAmount = feeCalc.waivedAmount;

      if (payment) {
        if (payment.status === "PENDING") {
          // Resident already submitted/captured this exact payment amount.
          finalCollectedAmount = Number(payment.amount ?? feeCalc.totalPayable);
          finalLateFeeAmount = payment.late_fee_amount != null
            ? Number(payment.late_fee_amount)
            : Math.max(0, Math.round((finalCollectedAmount - feeCalc.baseAmount) * 100) / 100);
          finalWaivedAmount = payment.waived_amount != null ? Number(payment.waived_amount) : feeCalc.waivedAmount;
        }
        if (payment.status !== "SUCCESS") {
          await payment.update(
            {
              status: "SUCCESS",
              society_id: societyId,
              resident_id: payment.resident_id || residentId,
              source,
              amount: finalCollectedAmount,
              base_amount: payment.base_amount ?? feeCalc.baseAmount,
              late_fee_amount: finalLateFeeAmount,
              waived_amount: finalWaivedAmount,
              payment_mode: resolvedMode,
              financial_account_id: resolvedAccountId,
              confirmed_by: reqUser?.id || null,
              confirmed_at: new Date(),
            },
            { transaction: t }
          );
        } else {
          finalCollectedAmount = Number(payment.amount ?? feeCalc.totalPayable);
          finalLateFeeAmount = Number(payment.late_fee_amount || 0);
        }
      } else {
        await Payment.create({
          bill_id: locked.id,
          society_id: societyId,
          financial_account_id: resolvedAccountId,
          resident_id: residentId,
          amount: finalCollectedAmount,
          base_amount: feeCalc.baseAmount,
          late_fee_amount: finalLateFeeAmount,
          waived_amount: finalWaivedAmount,
          payment_mode: resolvedMode,
          source,
          status: "SUCCESS",
          confirmed_by: reqUser?.id || null,
          confirmed_at: new Date(),
        }, { transaction: t });
      }

      // 2. Mark bill as PAID (preserve original Bill.amount)
      await locked.update({ status: "PAID" }, { transaction: t });

      // 3. Post a single Ledger CREDIT (idempotent via unique DB key).
      const payerFlat = locked.flat_id ? await Flat.findByPk(locked.flat_id, { attributes: ["flat_number"], transaction: t }) : null;
      const payerUser =
        ownerMembership?.User ||
        (residentId ? await User.findByPk(residentId, { attributes: ["name"], transaction: t }) : null);
      const payerText = [payerUser?.name, payerFlat?.flat_number ? `Flat ${payerFlat.flat_number}` : null].filter(Boolean).join(" · ");
      const lateSuffix = finalLateFeeAmount > 0 ? ` (incl. ₹${finalLateFeeAmount} late fee)` : "";
      const billDesc =
        source === "MAINTENANCE"
          ? `Maintenance (${locked.billing_month || locked.title || "Monthly"}) paid${lateSuffix}${payerText ? ` by ${payerText}` : ""}`
          : `${locked.title || "Society Bill"} paid${lateSuffix}${payerText ? ` by ${payerText}` : ""}`;

      await createLedgerEntry({
        societyId,
        type: "CREDIT",
        source,
        referenceId: locked.id,
        amount: finalCollectedAmount,
        entryDate: new Date().toISOString().slice(0, 10),
        description: billDesc,
        financialAccountId: resolvedAccountId,
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
        await notificationService.sendNotification({
          societyId,
          receiverUserId: user.id,
          title: "Bill Payment Confirmed",
          message: `✅ Your payment of ₹${bill.amount} for "${bill.title}" has been confirmed by Admin.`,
          type: "BILL",
          actionType: "BILL_CONFIRMED",
          actionRoute: "/resident/bills",
          fcmToken: user.fcm_token,
          sourceEventId: `BILL_CONFIRMED:${bill.id}:${user.id}`,
          extraData: {
            route: "/resident/bills",
            billId: bill.id.toString(),
            status: "PAID",
          },
        });
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

    const scope = resolveBillScope(req);
    if (!billInScope(scope, bill)) {
      return res.status(403).json({ success: false, message: "You are not authorized to confirm this bill." });
    }

    const targetSocietyId = scope.societyId || bill.Flat?.Block?.society_id || req.user.society_id;
    await processConfirmSingleBill(bill, req.user, targetSocietyId, {
      payment_mode: req.body?.payment_mode,
      financial_account_id: req.body?.financial_account_id,
    });

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

    const scope = resolveBillScope(req);
    if (!scope.isSuperAdmin && scope.societyId === null) {
      return res.status(403).json({ success: false, message: "Your account is not scoped to a society." });
    }
    const targetSocietyId = scope.societyId;

    const blockInclude = {
      model: Block,
      required: true,
      attributes: ["id", "name", "society_id"],
    };
    if (targetSocietyId !== null) {
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

    const pendingBills = bills.filter((b) => b.status === "PENDING");
    if (pendingBills.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve: ${pendingBills.length} of the selected bill(s) are still PENDING (unpaid). All selected bills must have status as PAID or Awaiting Confirmation before approving.`,
        pendingCount: pendingBills.length,
      });
    }

    let approvedCount = 0;

    for (const bill of bills) {
      await processConfirmSingleBill(bill, req.user, targetSocietyId);
      approvedCount++;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${approvedCount} bill(s).`,
      approvedCount,
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

    const scope = resolveBillScope(req);
    if (!scope.isSuperAdmin && scope.societyId === null) {
      return res.status(403).json({ success: false, message: "Your account is not scoped to a society." });
    }
    const targetSocietyId = scope.societyId;

    const blockInclude = {
      model: Block,
      required: true,
      attributes: ["id", "name", "society_id"],
    };
    if (targetSocietyId !== null) {
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
