

const { Op } = require("sequelize");

const VisitorLog = require("../models/VisitorLog");
const Complaint  = require("../models/Complaint");
const Flat       = require("../models/Flat");
const Floor      = require("../models/Floor");      // ✅ ADDED
const Block      = require("../models/Block");
const Society    = require("../models/Society");
const User       = require("../models/User");
const FlatMembership = require("../models/FlatMembership");
const Bill       = require("../models/Bill");
const LedgerEntry = require("../models/LedgerEntry");
const Payment    = require("../models/Payment");
const Expense    = require("../models/Expense");
const AmenityBooking = require("../models/AmenityBooking");

const PAGE_LIMIT = 15;

/* ═══════════════════════════════════════
   TENANT SCOPE RESOLVER (shared)
   A SUPER_ADMIN may look across every society, or narrow to one via the
   x-society-id header / society_id query.
   EVERY other role is hard-pinned to req.user.society_id — a client-supplied
   society_id can never widen their scope. (The older getFinancialReport
   resolved targetSocId as `header || query || user.society_id`, which let a
   society admin pass ?society_id=<other> and read another society's rows.)
   ═══════════════════════════════════════ */
const resolveReportScope = (req, societyIdQuery) => {
  if (req.user?.activeRole === "SUPER_ADMIN") {
    const raw = req.headers["x-society-id"] ||
      (societyIdQuery && societyIdQuery !== "ALL" ? societyIdQuery : null);
    // Normalise to a positive integer. Anything unparseable ("abc", "", "-1")
    // is treated as "no filter" so it degrades to the global view instead of
    // emitting `society_id = NaN` into the WHERE clause.
    const id = parseInt(raw, 10);
    return { isSuperAdmin: true, societyId: Number.isInteger(id) && id > 0 ? id : null };
  }
  const own = parseInt(req.user?.society_id, 10);
  return { isSuperAdmin: false, societyId: Number.isInteger(own) && own > 0 ? own : null };
};

/* Build a [from, to] day-boundary window for a date column, or null. */
const dateWindow = (fromDate, toDate) => {
  if (!fromDate || !toDate) return null;
  return {
    [Op.between]: [`${fromDate} 00:00:00`, `${toDate} 23:59:59`],
  };
};

/* ═══════════════════════════════════════
   VISITOR REPORT  ← PAGINATION
   ✅ Fixed: Floor → Block nested include
═══════════════════════════════════════ */
const getVisitorReport = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { fromDate, toDate, status, flat_id, block_id, floor_id, society_id } = req.query;
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];

    const where = {};
    if (!isGlobalSuperAdmin) {
      where.society_id = req.user.society_id;
    } else if (society_id && society_id !== "ALL") {
      where.society_id = society_id;
    }

    if (flat_id)  where.flat_id = flat_id;
    if (status === "IN")  where.exit_time = null;
    if (status === "OUT") where.exit_time = { [Op.ne]: null };

    if (fromDate && toDate) {
      where.entry_time = {
        [Op.between]: [
          `${fromDate} 00:00:00`,
          `${toDate} 23:59:59`,
        ],
      };
    }

    // ── Hierarchical Filter (Block/Floor) ──
    const flatWhere = {};
    if (block_id) flatWhere.block_id = block_id;
    if (floor_id) flatWhere.floor_id = floor_id;

    const { count, rows: visitors } = await VisitorLog.findAndCountAll({
      where,
      include: [
        {
          model: Flat,
          required: (block_id || floor_id) ? true : false,
          where:    flatWhere,
          attributes: ["id", "flat_number"],
          include: [
            {
              model: Floor,
              required: false,
              attributes: ["id", "floor_number"],
              include: [
                { 
                  model: Block, 
                  required: false, 
                  attributes: ["id", "name"],
                  include: [{ model: Society, attributes: ["id", "name"] }]
                },
              ],
            },
            {
              model: Block,           // ✅ direct Block fallback (row houses)
              required: false,
              attributes: ["id", "name"],
              include: [{ model: Society, attributes: ["id", "name"] }],
            },
          ],
        },
      ],
      order:  [["entry_time", "DESC"]],
      limit,
      offset,
    });

    // Unfiltered counts for stat strip
    const base = {};
    if (!isGlobalSuperAdmin) {
      base.society_id = req.user.society_id;
    } else if (society_id && society_id !== "ALL") {
      base.society_id = society_id;
    }
    if (flat_id) base.flat_id = flat_id;

    // For block/floor counts, we need a join
    const countInclude = [];
    if (block_id || floor_id) {
      countInclude.push({
        model:    Flat,
        required: true,
        where:    flatWhere,
      });
    }

    const [totalAll, totalIn, totalOut] = await Promise.all([
      VisitorLog.count({ where: base, include: countInclude }),
      VisitorLog.count({ where: { ...base, exit_time: null }, include: countInclude }),
      VisitorLog.count({ where: { ...base, exit_time: { [Op.ne]: null } }, include: countInclude }),
    ]);

    res.json({
      data: visitors,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts: { total: totalAll, inside: totalIn, exited: totalOut },
    });
  } catch (err) {
    console.error("❌ [getVisitorReport] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ═══════════════════════════════════════
   COMPLAINT REPORT  ← PAGINATION
═══════════════════════════════════════ */
const getComplaintReport = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { status, fromDate, toDate, block_id, floor_id, flat_id, society_id } = req.query;
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];

    const where = {};
    if (!isGlobalSuperAdmin) {
      where.society_id = req.user.society_id;
    } else if (society_id && society_id !== "ALL") {
      where.society_id = society_id;
    }

    if (status) where.status = status;
    if (flat_id) where.flat_id = flat_id;
    if (fromDate && toDate) {
      where.created_at = {
        [Op.between]: [
          `${fromDate} 00:00:00`,
          `${toDate} 23:59:59`,
        ],
      };
    }

    const flatWhere = {};
    if (block_id) flatWhere.block_id = block_id;
    if (floor_id) flatWhere.floor_id = floor_id;

    const { count, rows: complaints } = await Complaint.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ["id", "name"], required: false },
        { 
          model: Flat, 
          required: (block_id || floor_id) ? true : false,
          where: flatWhere,
          include: [
            { model: Block, attributes: ["name"], include: [{ model: Society, attributes: ["name"] }] }
          ]
        },
      ],
      order:    [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    // Unfiltered counts — society-scoped only
    const base = {};
    if (!isGlobalSuperAdmin) {
      base.society_id = req.user.society_id;
    } else if (society_id && society_id !== "ALL") {
      base.society_id = society_id;
    }
    if (flat_id) base.flat_id = flat_id;

    const countInclude = [];
    if (block_id || floor_id) {
      countInclude.push({ model: Flat, required: true, where: flatWhere });
    }

    const [totalAll, totalOpen, totalProgress, totalResolved] = await Promise.all([
      Complaint.count({ where: base, include: countInclude }),
      Complaint.count({ where: { ...base, status: "OPEN" }, include: countInclude }),
      Complaint.count({ where: { ...base, status: "IN_PROGRESS" }, include: countInclude }),
      Complaint.count({ where: { ...base, status: "RESOLVED" }, include: countInclude }),
    ]);

    res.json({
      data: complaints,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts: { total: totalAll, open: totalOpen, progress: totalProgress, resolved: totalResolved },
    });
  } catch (err) {
    console.error("❌ [getComplaintReport] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ═══════════════════════════════════════
   FINANCIAL REPORT  ← PAGINATION
═══════════════════════════════════════ */
const getFinancialReport = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { status, fromDate, toDate, block_id, floor_id, flat_id, society_id } = req.query;
    const targetSocId = req.headers["x-society-id"] || society_id || req.user.society_id;
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !targetSocId;

    const billWhere = {};
    if (status) billWhere.status = status;
    if (fromDate && toDate) {
      billWhere.created_at = {
        [Op.between]: [
          `${fromDate} 00:00:00`,
          `${toDate} 23:59:59`,
        ],
      };
    }

    // Resolve society, block, floor, flat scoping up-front to flat IDs
    let targetFlatIds = null;
    if (flat_id) {
      targetFlatIds = [parseInt(flat_id)];
    } else {
      const blockQuery = {};
      if (!isGlobalSuperAdmin && targetSocId && targetSocId !== "ALL") {
        blockQuery.society_id = targetSocId;
      }
      if (block_id) {
        blockQuery.id = block_id;
      }

      const hasBlockFilter = Object.keys(blockQuery).length > 0;
      let matchedBlockIds = null;
      if (hasBlockFilter) {
        const blocks = await Block.findAll({ where: blockQuery, attributes: ["id"] });
        matchedBlockIds = blocks.map((b) => b.id);
      }

      const flatQuery = {};
      if (matchedBlockIds !== null) {
        flatQuery.block_id = { [Op.in]: matchedBlockIds };
      }
      if (floor_id) {
        flatQuery.floor_id = floor_id;
      }

      if (Object.keys(flatQuery).length > 0) {
        const flats = await Flat.findAll({ where: flatQuery, attributes: ["id"] });
        targetFlatIds = flats.map((f) => f.id);
      }
    }

    if (targetFlatIds !== null) {
      billWhere.flat_id = { [Op.in]: targetFlatIds };
    }

    const flatInclude = {
      model: Flat,
      required: false,
      attributes: ["id", "flat_number", "floor_id", "block_id"],
      include: [
        {
          model: Block,
          required: false,
          attributes: ["id", "name"],
          include: [{ model: Society, attributes: ["id", "name"] }],
        },
        {
          model: Floor,
          required: false,
          attributes: ["id", "floor_number"],
        },
        {
          model: FlatMembership,
          required: false,
          where: { is_current: true },
          include: [{ model: User, required: false, attributes: ["id", "name", "email", "phone"] }],
        },
      ],
    };

    const { count, rows: bills } = await Bill.findAndCountAll({
      where:    billWhere,
      include:  [flatInclude],
      order:    [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
      col:      "id",
    });

    // Unfiltered counts for stat strip
    const allBills = await Bill.findAll({
      attributes: ["id", "status", "amount"],
      where: targetFlatIds !== null ? { flat_id: { [Op.in]: targetFlatIds } } : {},
    });

    const totalAll       = allBills.length;
    const totalPaid      = allBills.filter(b => b.status === "PAID").length;
    const totalPending   = allBills.filter(b => b.status !== "PAID").length;
    const totalCollected = allBills.filter(b => b.status === "PAID").reduce((s, b) => s + Number(b.amount), 0);
    const totalDue       = allBills.filter(b => b.status !== "PAID").reduce((s, b) => s + Number(b.amount), 0);

    const ledgerWhere = {};
    if (!isGlobalSuperAdmin && targetSocId && targetSocId !== "ALL") {
      ledgerWhere.society_id = targetSocId;
    }
    if (fromDate && toDate) {
      ledgerWhere.entry_date = {
        [Op.between]: [`${fromDate} 00:00:00`, `${toDate} 23:59:59`],
      };
    }

    const [creditEntries, debitEntries] = await Promise.all([
      LedgerEntry.findAll({
        where: { ...ledgerWhere, type: "CREDIT", status: { [Op.ne]: "REVERSED" } },
        attributes: ["amount", "source"],
      }),
      LedgerEntry.findAll({
        where: { ...ledgerWhere, type: "DEBIT", status: { [Op.ne]: "REVERSED" } },
        attributes: ["amount", "source"],
      }),
    ]);

    const income = { BILL: 0, MAINTENANCE: 0, AMENITY: 0 };
    creditEntries.forEach((e) => {
      const src = e.source || "BILL";
      income[src in income ? src : "BILL"] += Number(e.amount);
    });
    const credited   = creditEntries.reduce((s, e) => s + Number(e.amount), 0);
    const debited    = debitEntries.reduce((s, e) => s + Number(e.amount), 0);
    const currentBalance = credited - debited;

    const formattedBills = bills.map((bill) => {
      const b = bill.toJSON ? bill.toJSON() : bill;
      if (b.Flat) {
        const active = b.Flat.FlatMemberships?.find((m) => m.is_current) || b.Flat.FlatMemberships?.[0];
        b.Flat.User = active?.User || null;
      }
      return b;
    });

    res.json({
      data: formattedBills,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts: { total: totalAll, paid: totalPaid, pending: totalPending, collected: totalCollected, due: totalDue },
      ledger: {
        income: { bills: income.BILL + income.MAINTENANCE, amenities: income.AMENITY, total: credited },
        expensesTotal: debited,
        currentBalance,
      },
    });
  } catch (err) {
    console.error("❌ [getFinancialReport] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ═══════════════════════════════════════
   PAYMENT REPORT  ← PAGINATION
   Money-IN, read straight from the `payments` table (not `bills`).
   Super Admin → every society (optionally narrowed by x-society-id / ?society_id).
   Society Admin / Committee / Accountant → pinned to their own society.
   ═══════════════════════════════════════ */
const getPaymentReport = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { status, source, payment_mode, fromDate, toDate,
            block_id, floor_id, flat_id, society_id } = req.query;

    const { isSuperAdmin, societyId: targetSocId } = resolveReportScope(req, society_id);

    const where = {};
    if (targetSocId !== null) where.society_id = targetSocId;
    if (status)          where.status = status;
    if (source)          where.source = source;
    if (payment_mode)    where.payment_mode = payment_mode;

    const win = dateWindow(fromDate, toDate);
    if (win) where.payment_date = win;

    // Block/Floor/Flat narrow to payment ids via Bill → Flat, and to
    // amenity-payment ids via AmenityBooking → Flat. Only one branch can hold
    // rows for a given source, so a single OR is enough.
    const flatFilters = [];
    // `flats` has no flat_id column — a flat's own key is `id`.
    if (flat_id)  flatFilters.push({ id: parseInt(flat_id, 10) });
    if (floor_id) flatFilters.push({ floor_id: floor_id });
    if (block_id) {
      // A block must never be resolved across societies.
      const blockWhere = { id: block_id };
      if (targetSocId !== null) blockWhere.society_id = targetSocId;
      const block = await Block.findOne({ where: blockWhere, attributes: ["id"] });
      if (!block) {
        return res.json({
          data: [],
          pagination: { currentPage: page, totalPages: 0, totalItems: 0, limit },
          counts: { total: 0, success: 0, pending: 0, failed: 0, cancelled: 0, collected: 0, pendingAmount: 0 },
        });
      }
      flatFilters.push({ block_id: block.id });
    }

    if (flatFilters.length > 0) {
      const flats = await Flat.findAll({
        where: { [Op.or]: flatFilters },
        attributes: ["id"],
      });
      const flatIds = flats.map((f) => f.id);

      if (flatIds.length === 0) {
        return res.json({
          data: [],
          pagination: { currentPage: page, totalPages: 0, totalItems: 0, limit },
          counts: { total: 0, success: 0, pending: 0, failed: 0, cancelled: 0, collected: 0, pendingAmount: 0 },
        });
      }

      where[Op.or] = [
        { bill_id: { [Op.in]: await Bill.findAll({ where: { flat_id: { [Op.in]: flatIds } }, attributes: ["id"] }).then((r) => r.map((b) => b.id)) } },
        { amenity_booking_id: { [Op.in]: await AmenityBooking.findAll({ where: { flat_id: { [Op.in]: flatIds } }, attributes: ["id"] }).then((r) => r.map((b) => b.id)) } },
      ];
    }

    const { count, rows: payments } = await Payment.findAndCountAll({
      where,
      include: [
        { model: Society, as: "society", required: false, attributes: ["id", "name"] },
        { model: User, as: "resident", required: false, attributes: ["id", "name", "email", "phone"] },
        {
          model: Bill,
          required: false,
          // Real Bill columns: there is no `bill_type` — the BILL/MAINTENANCE
          // discriminator is `type`, and the category lives in `bill_category`.
          attributes: ["id", "title", "type", "status", "bill_category"],
          include: [{
            model: Flat,
            required: false,
            attributes: ["id", "flat_number", "floor_id", "block_id"],
            include: [
              { model: Block, required: false, attributes: ["id", "name"] },
              { model: Floor, required: false, attributes: ["id", "floor_number"] },
            ],
          }],
        },
        {
          model: AmenityBooking,
          as: "booking",
          required: false,
          // AmenityBooking has no `amount` column — the paid amount lives on
          // the Payment row itself. It does track `payment_status`.
          attributes: ["id", "status", "payment_status"],
          include: [{
            model: Flat,
            required: false,
            attributes: ["id", "flat_number", "floor_id", "block_id"],
            include: [
              { model: Block, required: false, attributes: ["id", "name"] },
              { model: Floor, required: false, attributes: ["id", "floor_number"] },
            ],
          }],
        },
      ],
      order: [["payment_date", "DESC"], ["id", "DESC"]],
      limit,
      offset,
    });

    // Stat strip: same tenant scope, ignoring the status/source/mode filters
    // so the tiles always describe the whole visible slice.
    const statWhere = {};
    if (targetSocId !== null) statWhere.society_id = targetSocId;

    const all = await Payment.findAll({ attributes: ["status", "amount"], where: statWhere });
    const collected = all
      .filter((p) => p.status === "SUCCESS")
      .reduce((s, p) => s + Number(p.amount), 0);
    const pendingAmount = all
      .filter((p) => p.status === "PENDING")
      .reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      data: payments,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts: {
        total: all.length,
        success: all.filter((p) => p.status === "SUCCESS").length,
        pending: all.filter((p) => p.status === "PENDING").length,
        failed: all.filter((p) => p.status === "FAILED").length,
        cancelled: all.filter((p) => p.status === "CANCELLED").length,
        collected,
        pendingAmount,
      },
      scope: { isSuperAdmin, societyId: targetSocId },
    });
  } catch (err) {
    console.error("❌ [getPaymentReport] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ═══════════════════════════════════════
   EXPENSE REPORT  ← PAGINATION
   Money-OUT, read from the `expenses` table.
   Super Admin → every society; every other role → pinned to their own society.
   ═══════════════════════════════════════ */
const getExpenseReport = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const { status, paid_by, payment_mode, fromDate, toDate, society_id } = req.query;

    const { isSuperAdmin, societyId: targetSocId } = resolveReportScope(req, society_id);

    const where = {};
    if (targetSocId !== null) where.society_id = targetSocId;
    if (status)       where.status = status;
    if (paid_by)      where.paid_by = paid_by;
    if (payment_mode) where.payment_mode = payment_mode;

    const win = dateWindow(fromDate, toDate);
    if (win) where.payment_date = win;

    const { count, rows: expenses } = await Expense.findAndCountAll({
      where,
      include: [{ model: Society, as: "society", required: false, attributes: ["id", "name"] }],
      order: [["payment_date", "DESC"], ["id", "DESC"]],
      limit,
      offset,
    });

    const statWhere = {};
    if (targetSocId !== null) statWhere.society_id = targetSocId;

    const all = await Expense.findAll({ attributes: ["status", "amount"], where: statWhere });
    const posted = all.filter((e) => e.status === "POSTED");
    const voided = all.filter((e) => e.status === "VOID");

    res.json({
      data: expenses,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts: {
        total: all.length,
        posted: posted.length,
        voided: voided.length,
        totalExpense: posted.reduce((s, e) => s + Number(e.amount), 0),
        voidAmount: voided.reduce((s, e) => s + Number(e.amount), 0),
      },
      scope: { isSuperAdmin, societyId: targetSocId },
    });
  } catch (err) {
    console.error("❌ [getExpenseReport] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getVisitorReport,
  getComplaintReport,
  getFinancialReport,
  getPaymentReport,
  getExpenseReport,
};