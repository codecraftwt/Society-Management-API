const { Op, Sequelize } = require("sequelize");
const {
  MaintenanceRate,
  MaintenanceLateFeeConfig,
  Bill,
  BillLateFeeWaiver,
  Payment,
  Flat,
  Block,
  FlatMembership,
  User,
  Notification,
  UserSetting,
  SocietyFinancialAccount,
} = require("../models");
const sequelize = require("../config/db");
const { calculateLateFee, buildBillLateFeeFields } = require("../utils/lateFeeHelper");
const { sendPushNotification } = require("../utils/pushNotification");
const { auditLog, getDefaultBankAccount } = require("../utils/ledgerService");
const { formatAccount } = require("./financialAccountControllers");
const notificationService = require("../services/notificationService");
const { getOccupancyContextForFlats } = require("../utils/flatOccupancy");

/* Best-effort audit stamp so a failure in the audit book never blocks the
   actual maintenance operation (configs/bills are not transactional here). */
async function stampAudit(payload) {
  try {
    await auditLog(payload);
  } catch (err) {
    console.error("[maintenanceController] auditLog failed:", err.message);
  }
}

const MAINTENANCE_TYPES = ["LUMPSUM", "SQ_FEET", "FLAT"];
const FLAT_TYPES = ["1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL", "ALL"];
const RESIDENT_TYPES = ["OWNER", "TENANT"];
const FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"];

const LATE_FEE_TYPES = ["FIXED_PER_MONTH", "FIXED_ONE_TIME", "PERCENT_PER_MONTH"];

function normalizeLateFeePolicyInput(body = {}, fallbackConfig = null) {
  const hasExplicitEnabled = body.late_fee_enabled !== undefined || body.is_enabled !== undefined;
  const isEnabled = hasExplicitEnabled
    ? Boolean(body.late_fee_enabled ?? body.is_enabled)
    : Boolean(fallbackConfig?.is_enabled);

  const rawType = body.late_fee_type ?? body.fee_type ?? fallbackConfig?.fee_type ?? "FIXED_PER_MONTH";
  const feeType = String(rawType).toUpperCase();
  if (!LATE_FEE_TYPES.includes(feeType)) {
    return { error: `late_fee_type must be one of: ${LATE_FEE_TYPES.join(", ")}` };
  }

  const rawValue = body.late_fee_value ?? body.fee_amount ?? fallbackConfig?.fee_amount ?? 0;
  const feeValue = Number(rawValue);
  if (!Number.isFinite(feeValue) || feeValue < 0) {
    return { error: "Late fee amount must be a non-negative number." };
  }
  if (feeType === "PERCENT_PER_MONTH" && feeValue > 100) {
    return { error: "Percentage late fee cannot exceed 100%." };
  }

  const rawGrace = body.late_fee_grace_days ?? body.grace_days ?? fallbackConfig?.grace_days ?? 0;
  const graceDays = parseInt(rawGrace, 10);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) {
    return { error: "Grace days must be a whole number between 0 and 365." };
  }

  const rawMax = body.late_fee_max_amount !== undefined ? body.late_fee_max_amount : (body.max_fee_amount !== undefined ? body.max_fee_max_amount : fallbackConfig?.max_fee_amount);
  let maxFeeAmount = null;
  if (rawMax !== undefined && rawMax !== null && rawMax !== "") {
    const parsedMax = Number(rawMax);
    if (!Number.isFinite(parsedMax) || parsedMax < 0) {
      return { error: "Maximum late fee must be a non-negative number." };
    }
    maxFeeAmount = parsedMax;
  }

  return {
    data: {
      is_enabled: isEnabled,
      fee_type: feeType,
      fee_amount: feeValue,
      grace_days: graceDays,
      max_fee_amount: maxFeeAmount,
    },
  };
}

/* ─────────────────────────────────────────
   GET SOCIETY LATE FEE CONFIG
   GET /maintenance/late-fee-config
───────────────────────────────────────── */
const getLateFeeConfig = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const config = await MaintenanceLateFeeConfig.findOne({ where: { society_id: societyId } });
    if (!config) {
      return res.json({
        society_id: societyId,
        is_enabled: false,
        fee_type: "FIXED_PER_MONTH",
        fee_amount: 0,
        grace_days: 0,
        max_fee_amount: null,
      });
    }
    return res.json(config);
  } catch (err) {
    console.error("[getLateFeeConfig]", err);
    return res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   SAVE SOCIETY LATE FEE CONFIG
   POST/PUT /maintenance/late-fee-config
───────────────────────────────────────── */
const saveLateFeeConfig = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { data, error } = normalizeLateFeePolicyInput(req.body);
    if (error) return res.status(400).json({ message: error });

    let config = await MaintenanceLateFeeConfig.findOne({ where: { society_id: societyId } });
    const oldVal = config ? config.toJSON() : null;
    if (config) {
      await config.update({ ...data, updated_by: req.user.id });
    } else {
      config = await MaintenanceLateFeeConfig.create({
        society_id: societyId,
        ...data,
        created_by: req.user.id,
        updated_by: req.user.id,
      });
    }

    await stampAudit({
      societyId,
      action: oldVal ? "LATE_FEE_CONFIG_UPDATED" : "LATE_FEE_CONFIG_CREATED",
      entityType: "MaintenanceLateFeeConfig",
      entityId: config.id,
      oldValue: oldVal,
      newValue: config.toJSON(),
      reason: null,
      actor: req.user,
    });

    return res.status(oldVal ? 200 : 201).json({ config });
  } catch (err) {
    console.error("[saveLateFeeConfig]", err);
    return res.status(500).json({ message: err.message });
  }
};

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const monthNameAndYear = (d = new Date()) =>
  `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;

/* Validate + normalize a config payload for a rate. */
function normalizeRateInput(body, society_id) {
  const {
    maintenance_type,
    name,
    flat_type,
    resident_type,
    amount,
    owner_amount,
    tenant_amount,
    rate_per_sqft,
    owner_rate_per_sqft,
    tenant_rate_per_sqft,
    frequency,
    description,
    is_active,
    financial_account_id,
  } = body;
  const validNonNegative = (value) => value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

  if (!maintenance_type || !MAINTENANCE_TYPES.includes(maintenance_type)) {
    return { error: `maintenance_type must be one of: ${MAINTENANCE_TYPES.join(", ")}` };
  }

  if (frequency && !FREQUENCIES.includes(frequency)) {
    return { error: `frequency must be one of: ${FREQUENCIES.join(", ")}` };
  }

  if (flat_type && !FLAT_TYPES.includes(flat_type)) {
    return { error: `flat_type must be one of: ${FLAT_TYPES.join(", ")}` };
  }
  if (resident_type && !RESIDENT_TYPES.includes(resident_type)) {
    return { error: `resident_type must be OWNER or TENANT` };
  }

  if (maintenance_type === "LUMPSUM") {
    if (!validNonNegative(owner_amount ?? amount) || (tenant_amount !== undefined && !validNonNegative(tenant_amount))) {
      return { error: "amount is required and must be a non-negative number for LUMPSUM" };
    }
  } else if (maintenance_type === "SQ_FEET") {
    if (!validNonNegative(owner_rate_per_sqft ?? rate_per_sqft) || (tenant_rate_per_sqft !== undefined && !validNonNegative(tenant_rate_per_sqft))) {
      return { error: "rate_per_sqft is required and must be a non-negative number for SQ_FEET" };
    }
  } else if (maintenance_type === "FLAT") {
    if (!flat_type) return { error: "flat_type is required for FLAT maintenance" };
    if (!validNonNegative(owner_amount ?? amount) || (tenant_amount !== undefined && !validNonNegative(tenant_amount))) {
      return { error: "amount is required and must be a non-negative number for FLAT" };
    }
  }

  return {
    data: {
      society_id,
      maintenance_type,
      name: (name || "").toString().trim() || null,
      flat_type: maintenance_type === "FLAT" ? flat_type : (flat_type || null),
      resident_type: resident_type || null,
      amount: maintenance_type === "SQ_FEET" ? null : (amount !== undefined && amount !== null ? Number(amount) : null),
      owner_amount: maintenance_type === "SQ_FEET" ? null : Number(owner_amount ?? amount),
      tenant_amount: maintenance_type === "SQ_FEET" ? null : Number(tenant_amount ?? owner_amount ?? amount),
      rate_per_sqft: maintenance_type === "SQ_FEET" ? Number(rate_per_sqft) : (rate_per_sqft !== undefined && rate_per_sqft !== null ? Number(rate_per_sqft) : null),
      owner_rate_per_sqft: maintenance_type === "SQ_FEET" ? Number(owner_rate_per_sqft ?? rate_per_sqft) : null,
      tenant_rate_per_sqft: maintenance_type === "SQ_FEET" ? Number(tenant_rate_per_sqft ?? owner_rate_per_sqft ?? rate_per_sqft) : null,
      frequency: frequency || "MONTHLY",
      description: (description || "").toString().trim() || null,
      is_active: is_active === undefined ? true : !!is_active,
      financial_account_id: financial_account_id ? parseInt(financial_account_id, 10) : null,
    },
  };
}

/* Resolve the distinct flat types that actually exist in a society's flats
   (via Block -> society_id), so the frontend only offers real options and
   new FLAT configs are validated against them. */
async function getSocietyFlatTypes(societyId) {
  const blockIds = (
    await Block.findAll({ where: { society_id: societyId }, attributes: ["id"] })
  ).map((b) => b.id);

  const flats = await Flat.findAll({
    where: { block_id: { [Op.in]: blockIds } },
    attributes: ["flat_type"],
  });

  const set = new Set();
  flats.forEach((f) => f.flat_type && set.add(f.flat_type));
  return Array.from(set).sort();
}

/* ─────────────────────────────────────────
   GET AVAILABLE FLAT TYPES
   GET /maintenance/flat-types
   Flat types present in this society's flats.
───────────────────────────────────────── */
const listFlatTypes = async (req, res) => {
  try {
    const types = await getSocietyFlatTypes(req.user.society_id);
    return res.json({ flat_types: types });
  } catch (err) {
    console.error("[listFlatTypes]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   GET CONFIGS (list)
   GET /maintenance/config
───────────────────────────────────────── */
const getConfigs = async (req, res) => {
  try {
    const rates = await MaintenanceRate.findAll({
      where: { society_id: req.user.society_id },
      include: [
        {
          model: SocietyFinancialAccount,
          as: "financialAccount",
          required: false,
          attributes: ["id", "account_name", "account_type", "bank_name", "account_number", "status"],
        },
      ],
      order: [["maintenance_type", "ASC"], ["flat_type", "ASC"], ["id", "ASC"]],
    });
    const formatted = rates.map((r) => {
      const j = r.toJSON();
      if (j.financialAccount) j.financialAccount = formatAccount(j.financialAccount);
      return j;
    });
    return res.json(formatted);
  } catch (err) {
    console.error("[getConfigs]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   SAVE CONFIG (create or update)
   POST /maintenance/config
───────────────────────────────────────── */
const saveConfig = async (req, res) => {
  try {
    const { error, data } = normalizeRateInput(req.body, req.user.society_id);
    if (error) return res.status(400).json({ message: error });

    if (data.financial_account_id) {
      const acc = await SocietyFinancialAccount.findOne({
        where: { id: data.financial_account_id, society_id: req.user.society_id },
      });
      if (!acc) return res.status(404).json({ message: "Selected collection bank account not found." });
      if (acc.status !== "ACTIVE") return res.status(400).json({ message: "Selected collection bank account is inactive." });
      if (acc.account_type === "CASH") return res.status(400).json({ message: "Maintenance collection account must be a Bank Account, not Cash." });
    }

    // Validate FLAT configs against the flat types that actually exist in this society.
    if (data.maintenance_type === "FLAT") {
      const existingTypes = await getSocietyFlatTypes(req.user.society_id);
      if (data.flat_type !== "ALL" && !existingTypes.includes(data.flat_type)) {
        return res.status(400).json({
          message: `No '${data.flat_type}' flats exist in this society. Available flat types: ${existingTypes.length ? existingTypes.join(", ") : "none yet"}`,
        });
      }
    }

    const { maintenance_type, flat_type, resident_type, ...rest } = data;

    const where = { society_id: req.user.society_id, maintenance_type };
    if (flat_type) where.flat_type = flat_type;
    if (resident_type) where.resident_type = resident_type;

    const [rate, created] = await MaintenanceRate.findOrCreate({ where, defaults: data });
    if (!created) await rate.update(data);

    await stampAudit({
      societyId: req.user.society_id,
      action: created ? "MAINTENANCE_CONFIG_CREATED" : "MAINTENANCE_CONFIG_UPDATED",
      entityType: "MaintenanceRate",
      entityId: rate.id,
      newValue: rate.toJSON(),
      reason: null,
      actor: req.user,
    });

    return res.status(created ? 201 : 200).json({ rate, action: created ? "created" : "updated" });
  } catch (err) {
    console.error("[saveConfig]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   DELETE / DEACTIVATE CONFIG
   DELETE /maintenance/config/:id
   Hard-deletes only if no bills reference it; otherwise soft-deactivates.
───────────────────────────────────────── */
const deleteConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const rate = await MaintenanceRate.findOne({
      where: { id, society_id: req.user.society_id },
    });
    if (!rate) return res.status(404).json({ message: "Configuration not found" });

    const referenced = await Bill.count({ where: { maintenance_rate_id: rate.id } });
    if (referenced > 0) {
      await rate.update({ is_active: false });
      await stampAudit({
        societyId: req.user.society_id,
        action: "MAINTENANCE_CONFIG_DELETED",
        entityType: "MaintenanceRate",
        entityId: rate.id,
        oldValue: { is_active: true },
        newValue: { is_active: false },
        reason: "Configuration referenced by generated bills — deactivated instead of deleted.",
        actor: req.user,
      });
      return res.json({
        message: "Configuration has been used by generated bills, so it was deactivated instead of deleted.",
        rate,
      });
    }

    await rate.destroy();
    await stampAudit({
      societyId: req.user.society_id,
      action: "MAINTENANCE_CONFIG_DELETED",
      entityType: "MaintenanceRate",
      entityId: Number(id),
      oldValue: rate.toJSON(),
      newValue: null,
      reason: "Configuration permanently deleted.",
      actor: req.user,
    });
    return res.json({ message: "Configuration deleted", id: rate.id });
  } catch (err) {
    console.error("[deleteConfig]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   SHARED RATE RESOLUTION LOGIC
   - Evaluates active rates with priority:
     1) Specific individual BHK rate for flat.flat_type
     2) Active "ALL" BHK rate fallback
   - Lumpsum applies to all properties (both Flats and Row Houses)
   - SQ_FEET applies to Row Houses
   - Detects conflicting active configurations of the same priority
   - Guarantees zero duplicate bills per property and billing period
───────────────────────────────────────── */
function resolveBillingItems({ rates, eligibleFlats, requestedMonth, due_date, existingMap }) {
  // 1. Conflict detection among active rates
  const seenRates = new Map();
  for (const r of rates) {
    if (!r.is_active) continue;
    const key = `${r.maintenance_type}:${r.flat_type || "NONE"}:${r.resident_type || "OWNER"}`;
    if (seenRates.has(key)) {
      const typeLabel = r.flat_type ? (r.flat_type === "ALL" ? "All BHK" : r.flat_type) : r.maintenance_type;
      throw new Error(`Conflicting active configurations found for ${typeLabel} (${r.resident_type || "OWNER"}). Please deactivate duplicate active rates before generating bills.`);
    }
    seenRates.set(key, r);
  }

  // 2. Partition active rates
  const activeRates = rates.filter((r) => r.is_active);
  const lumpsumRates = activeRates.filter((r) => r.maintenance_type === "LUMPSUM");
  const sqftRates = activeRates.filter((r) => r.maintenance_type === "SQ_FEET");
  const flatRates = activeRates.filter((r) => r.maintenance_type === "FLAT");

  const individualBhkMap = new Map();
  const allBhkMap = new Map();
  for (const r of flatRates) {
    const resRole = r.resident_type || "OWNER";
    if (r.flat_type === "ALL") {
      allBhkMap.set(`ALL:${resRole}`, r);
      if (!r.resident_type || r.tenant_amount !== null && r.tenant_amount !== undefined) allBhkMap.set("ALL:TENANT", r);
    } else {
      individualBhkMap.set(`${r.flat_type}:${resRole}`, r);
      if (!r.resident_type || r.tenant_amount !== null && r.tenant_amount !== undefined) individualBhkMap.set(`${r.flat_type}:TENANT`, r);
    }
  }

  const items = [];
  let totalAmount = 0;
  let alreadyBilledCount = 0;
  const ratesAppliedMap = new Map();

  const recordItem = (flat, rate, amount, calcDetails, extra = {}) => {
    const isDuplicate = existingMap.has(`${flat.id}:${rate.id}`);
    if (isDuplicate) {
      alreadyBilledCount += 1;
    } else {
      totalAmount += amount;
    }
    ratesAppliedMap.set(rate.id, rate);
    const membership = flat.occupancy_context?.owner || flat.FlatMemberships?.[0];
    const user = membership?.User;
    const rateName = rate.name || (rate.flat_type === "ALL" ? "All BHK Maintenance" : `${rate.flat_type || ""} ${rate.maintenance_type}`.trim());

    items.push({
      flat_id: flat.id,
      flat_number: flat.flat_number,
      flat_type: flat.flat_type,
      property_type: flat.Block?.property_type || "APARTMENT",
      block_name: flat.Block?.name || "—",
      resident_id: user?.id || membership?.user_id,
      resident_name: user?.name || "Owner",
      resident_email: user?.email || "",
      resident_phone: user?.phone || "",
      role: membership?.role || "OWNER",
      occupancy_status: flat.occupancy_context?.occupancyStatus === "RENTED" ? "TENANT_OCCUPIED" : (flat.occupancy_context?.occupancyStatus || "OWNER_OCCUPIED"),
      owner_name: flat.occupancy_context?.owner?.User?.name || null,
      tenant_name: flat.occupancy_context?.activeTenant?.User?.name || null,
      rate_id: rate.id,
      rate_name: rateName,
      maintenance_type: rate.maintenance_type,
      amount,
      calculation_details: calcDetails,
      is_already_billed: isDuplicate,
      due_date: due_date || addDays(30),
      ...extra,
    });
  };

  /* ─── A. SQ_FEET: Row houses calculation ─── */
  for (const rate of sqftRates) {
    const ratePerSqft = Number(rate.rate_per_sqft);
    const sqftFlats = eligibleFlats.filter((f) => f.Block?.property_type === "ROW_HOUSE");
    for (const flat of sqftFlats) {
      if (flat.occupancy_context?.occupancyStatus === "VACANT") continue;
      const occupancyRole = flat.occupancy_context?.occupancyStatus === "RENTED" ? "TENANT" : "OWNER";
      const area = flat.area_sqft ? Number(flat.area_sqft) : 0;
      const selectedRate = Number(occupancyRole === "TENANT" ? (rate.tenant_rate_per_sqft ?? rate.rate_per_sqft) : (rate.owner_rate_per_sqft ?? rate.rate_per_sqft));
      const amount = area * selectedRate;
      const hasArea = area > 0;
      const calcDetails = {
        maintenance_type: "SQ_FEET",
        area_sqft: area,
        rate_per_sqft: selectedRate,
        occupancy_at_generation: occupancyRole === "TENANT" ? "TENANT_OCCUPIED" : "OWNER_OCCUPIED",
        owner_rate_per_sqft: Number(rate.owner_rate_per_sqft ?? rate.rate_per_sqft),
        tenant_rate_per_sqft: Number(rate.tenant_rate_per_sqft ?? rate.rate_per_sqft),
        calculation: `${area} × ${selectedRate}`,
        calculated_amount: amount,
      };
      recordItem(flat, rate, hasArea ? amount : 0, calcDetails, {
        area_sqft: area,
        rate_per_sqft: ratePerSqft,
        has_area: hasArea,
      });
    }
  }

  /* ─── B. LUMPSUM: Both Flats AND Row Houses receive fixed amount ─── */
  for (const rate of lumpsumRates) {
    const amount = Number(rate.amount || 0);
    for (const flat of eligibleFlats) {
      if (flat.occupancy_context?.occupancyStatus === "VACANT") continue;
      const isTenant = flat.occupancy_context?.occupancyStatus === "RENTED";
      const amount = Number(isTenant ? (rate.tenant_amount ?? rate.amount) : (rate.owner_amount ?? rate.amount) || 0);
      const calcDetails = {
        maintenance_type: "LUMPSUM",
        property_type: flat.Block?.property_type || "APARTMENT",
        owner_base_amount: Number(rate.owner_amount ?? rate.amount ?? 0),
        tenant_configured_amount: Number(rate.tenant_amount ?? rate.amount ?? 0),
        additional_tenant_charge: isTenant ? Number(rate.tenant_amount ?? rate.amount ?? 0) - Number(rate.owner_amount ?? rate.amount ?? 0) : 0,
        occupancy_at_generation: isTenant ? "TENANT_OCCUPIED" : "OWNER_OCCUPIED",
        configured_amount: amount,
      };
      recordItem(flat, rate, amount, calcDetails);
    }
  }

  /* ─── C. FLAT Type: Individual BHK takes priority, All BHK acts as fallback ─── */
  if (flatRates.length > 0) {
    for (const flat of eligibleFlats) {
      if (flat.occupancy_context?.occupancyStatus === "VACANT") continue;
      const residentRole = flat.occupancy_context?.occupancyStatus === "RENTED" ? "TENANT" : "OWNER";
      const indKey = `${flat.flat_type}:${residentRole}`;
      const allKey = `ALL:${residentRole}`;

      let chosenRate = null;
      let appliedConfig = null;

      // Priority 1: Individual BHK rate
      if (individualBhkMap.has(indKey)) {
        chosenRate = individualBhkMap.get(indKey);
        appliedConfig = "INDIVIDUAL_BHK";
      }
      // Priority 2: All BHK fallback rate
      else if (allBhkMap.has(allKey)) {
        chosenRate = allBhkMap.get(allKey);
        appliedConfig = "ALL_BHK";
      }

      if (chosenRate) {
        const isTenant = residentRole === "TENANT";
        const ownerAmount = Number(chosenRate.owner_amount ?? chosenRate.amount ?? 0);
        const tenantAmount = Number(chosenRate.tenant_amount ?? chosenRate.amount ?? 0);
        const amount = isTenant ? tenantAmount : ownerAmount;
        const calcDetails = {
          maintenance_type: "FLAT",
          flat_type: flat.flat_type,
          applied_config: appliedConfig,
          owner_base_amount: ownerAmount,
          tenant_configured_amount: tenantAmount,
          additional_tenant_charge: isTenant ? tenantAmount - ownerAmount : 0,
          occupancy_at_generation: isTenant ? "TENANT_OCCUPIED" : "OWNER_OCCUPIED",
          configured_amount: amount,
        };
        recordItem(flat, chosenRate, amount, calcDetails);
      }
    }
  }

  return {
    items,
    totalAmount,
    alreadyBilledCount,
    ratesApplied: Array.from(ratesAppliedMap.values()),
  };
}

/* ─────────────────────────────────────────
   PREVIEW MAINTENANCE BILLS
   POST or GET /maintenance/preview
   Body / Query: { billing_month?, rate_ids?, due_date? }
───────────────────────────────────────── */
const previewBills = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { billing_month, rate_ids, due_date, issue_date, last_pay_date } = req.method === "GET" ? req.query : req.body;

    const requestedMonth = (billing_month && String(billing_month).trim()) || monthNameAndYear();
    const previewIssueDate = issue_date || new Date().toISOString().slice(0, 10);
    const previewDueDate = last_pay_date || due_date || addDays(30);

    const rateWhere = { society_id: societyId, is_active: true };
    let parsedRateIds = rate_ids;
    if (rate_ids === "ALL") {
      parsedRateIds = null;
    } else if (typeof rate_ids === "string") {
      try {
        parsedRateIds = JSON.parse(rate_ids);
      } catch (e) {
        parsedRateIds = rate_ids.split(",").map(Number).filter(Boolean);
      }
    }
    if (Array.isArray(parsedRateIds) && parsedRateIds.length > 0) {
      rateWhere.id = { [Op.in]: parsedRateIds };
    }

    const rates = await MaintenanceRate.findAll({ where: rateWhere });
    if (rates.length === 0) {
      return res.json({
        billing_month: requestedMonth,
        issue_date: previewIssueDate,
        due_date: previewDueDate,
        last_pay_date: previewDueDate,
        eligible_count: 0,
        billable_count: 0,
        already_billed_count: 0,
        total_amount: 0,
        residents: [],
        message: "No active maintenance configurations found to preview.",
      });
    }

    const blockIds = (
      await Block.findAll({
        where: { society_id: societyId },
        attributes: ["id"],
      })
    ).map((b) => b.id);

    const eligibleFlats = await Flat.findAll({
      where: { block_id: { [Op.in]: blockIds } },
      attributes: ["id", "flat_number", "flat_type", "block_id", "resident_id", "occupancy_status", "area_sqft"],
      include: [
        { model: Block, attributes: ["id", "name", "property_type"], required: false, where: { society_id: societyId } },
        {
          model: FlatMembership,
          required: false,
          attributes: ["id", "user_id", "role", "is_staying", "pays_maintenance", "is_current"],
          where: { is_current: true },
          include: [
            {
              model: User,
              attributes: ["id", "name", "email", "phone"],
            },
          ],
        },
        { model: User, required: false, attributes: ["id", "name", "email", "phone", "resident_type"] },
      ],
      order: [["id", "ASC"]],
    });

    const occupancy = await getOccupancyContextForFlats(eligibleFlats.map((f) => f.id));
    eligibleFlats.forEach((flat) => {
      const ctx = occupancy.get(flat.id);
      flat.occupancy_context = ctx;
      flat.FlatMemberships = ctx?.memberships || flat.FlatMemberships || [];
      // Some admin-residents are stored on Flat.resident_id without an
      // OWNER membership. Treat that assignment as the owner for billing.
      if (ctx && !ctx.owner && flat.resident_id && flat.User) {
        ctx.owner = { user_id: flat.resident_id, role: "OWNER", is_staying: true, User: flat.User };
        ctx.occupancyStatus = "OWNER_OCCUPIED";
      }
    });

    const existingBills = await Bill.findAll({
      where: {
        billing_month: requestedMonth,
        type: "MAINTENANCE",
      },
      attributes: ["flat_id", "maintenance_rate_id", "amount", "status"],
    });
    const existingMap = new Set(existingBills.map((b) => `${b.flat_id}:${b.maintenance_rate_id}`));

    const { items, totalAmount, alreadyBilledCount, ratesApplied } = resolveBillingItems({
      rates,
      eligibleFlats,
      requestedMonth,
      due_date: previewDueDate,
      existingMap,
    });

    return res.json({
      billing_month: requestedMonth,
      due_date: previewDueDate,
      eligible_count: items.length,
      billable_count: items.filter((i) => !i.is_already_billed).length,
      already_billed_count: alreadyBilledCount,
      total_amount: totalAmount,
      summary: {
        total_flats_evaluated: eligibleFlats.length,
        owner_occupied_flats: new Set(items.filter((i) => i.occupancy_status === "OWNER_OCCUPIED").map((i) => i.flat_id)).size,
        tenant_occupied_flats: new Set(items.filter((i) => i.occupancy_status === "TENANT_OCCUPIED").map((i) => i.flat_id)).size,
        vacant_flats: eligibleFlats.filter((f) => f.occupancy_context?.occupancyStatus === "VACANT").length,
        eligible_flats: items.length,
        excluded_flats: eligibleFlats.length - items.length,
        total_amount: totalAmount,
      },
      residents: items,
      rates_applied: ratesApplied.map((r) => ({
        id: r.id,
        name: r.name,
        maintenance_type: r.maintenance_type,
        flat_type: r.flat_type,
        amount: r.amount,
        owner_amount: r.owner_amount,
        tenant_amount: r.tenant_amount,
        owner_rate_per_sqft: r.owner_rate_per_sqft,
        tenant_rate_per_sqft: r.tenant_rate_per_sqft,
      })),
    });
  } catch (err) {
    console.error("[previewBills] error:", err);
    return res.status(400).json({ message: err.message || "Failed to preview maintenance bills" });
  }
};

/* ─────────────────────────────────────────
   GENERATE MAINTENANCE BILLS
   POST /maintenance/generate
   Body: { billing_month?, rate_ids?, due_date?, issue_date?, last_pay_date? }
───────────────────────────────────────── */
const generateBills = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { billing_month, rate_ids, due_date, issue_date, last_pay_date } = req.body;

    const requestedMonth = billing_month || monthNameAndYear();
    const monthRegex = /^[A-Za-z]+\s\d{4}$/;
    if (!monthRegex.test(requestedMonth)) {
      return res.status(400).json({ message: "billing_month must be in format like 'September 2026'" });
    }

    let parsedRateIds = rate_ids;
    if (rate_ids === "ALL") {
      parsedRateIds = null;
    } else if (typeof rate_ids === "string") {
      try {
        parsedRateIds = JSON.parse(rate_ids);
      } catch {
        parsedRateIds = rate_ids.split(",").map(Number).filter(Boolean);
      }
    }

    const rateWhere = { society_id: societyId, is_active: true };
    if (Array.isArray(parsedRateIds) && parsedRateIds.length > 0) {
      rateWhere.id = { [Op.in]: parsedRateIds };
    }

    const rates = await MaintenanceRate.findAll({ where: rateWhere });
    if (rates.length === 0) {
      return res.status(400).json({ message: "No active maintenance configurations found to generate from." });
    }

    const blockIds = (
      await Block.findAll({
        where: { society_id: societyId },
        attributes: ["id"],
      })
    ).map((b) => b.id);

    const eligibleFlats = await Flat.findAll({
      where: { block_id: { [Op.in]: blockIds } },
      attributes: ["id", "flat_number", "flat_type", "block_id", "resident_id", "occupancy_status", "area_sqft"],
      include: [
        { model: Block, attributes: ["id", "name", "property_type"], required: false, where: { society_id: societyId } },
        {
          model: FlatMembership,
          required: false,
          attributes: ["id", "user_id", "role"],
          where: { is_current: true },
        },
        { model: User, required: false, attributes: ["id", "name", "email", "phone", "resident_type"] },
      ],
      order: [["id", "ASC"]],
    });
    const occupancy = await getOccupancyContextForFlats(eligibleFlats.map((f) => f.id));
    eligibleFlats.forEach((flat) => {
      const ctx = occupancy.get(flat.id);
      flat.occupancy_context = ctx;
      flat.FlatMemberships = ctx?.memberships || flat.FlatMemberships || [];
      if (ctx && !ctx.owner && flat.resident_id && flat.User) {
        ctx.owner = { user_id: flat.resident_id, role: "OWNER", is_staying: true, User: flat.User };
        ctx.occupancyStatus = "OWNER_OCCUPIED";
      }
    });
    if (eligibleFlats.length === 0) {
      return res.status(400).json({ message: "No eligible owner flats found to bill." });
    }

    // Check for SQ_FEET missing area validation before generating bills
    const sqftRates = rates.filter((r) => r.maintenance_type === "SQ_FEET" && r.is_active);
    if (sqftRates.length > 0) {
      const sqftFlats = eligibleFlats.filter((f) => f.Block?.property_type === "ROW_HOUSE" && f.occupancy_context?.occupancyStatus !== "VACANT");
      const missingAreaFlats = sqftFlats.filter(
        (f) => !f.area_sqft || Number(f.area_sqft) <= 0
      );
      if (missingAreaFlats.length > 0) {
        return res.status(400).json({
          message: `SQ.FT maintenance bills cannot be generated. Area is missing for: ${missingAreaFlats.map((f) => f.flat_number).join(", ")}. Please update the property area before generating bills.`,
          missing_areas: missingAreaFlats.map((f) => f.flat_number),
        });
      }
    }

    // Existing bills for duplicate checking
    const existingBills = await Bill.findAll({
      where: {
        billing_month: requestedMonth,
        type: "MAINTENANCE",
      },
      attributes: ["flat_id", "maintenance_rate_id"],
    });
    const existingMap = new Set(existingBills.map((b) => `${b.flat_id}:${b.maintenance_rate_id}`));

    const finalDueDate = last_pay_date || due_date ? new Date(last_pay_date || due_date) : addDays(30);
    const finalIssueDate = issue_date ? new Date(issue_date) : new Date();

    const { items } = resolveBillingItems({
      rates,
      eligibleFlats,
      requestedMonth,
      due_date: finalDueDate,
      existingMap,
    });

    const results = [];
    const summary = { generated: 0, skipped_duplicates: 0, skipped_sqft: 0, missing_areas: [], errors: [] };
    const notified = new Set();
    const notificationQueue = [];

    const defaultBank = await getDefaultBankAccount(societyId);
    const rateById = new Map(rates.map((r) => [r.id, r]));
    const societyLateFeeConfig = await MaintenanceLateFeeConfig.findOne({ where: { society_id: societyId } });
    const { data: lateFeePolicy, error: lateFeeError } = normalizeLateFeePolicyInput(req.body, societyLateFeeConfig);
    if (lateFeeError) {
      return res.status(400).json({ message: lateFeeError });
    }

    for (const item of items) {
      if (item.is_already_billed) {
        summary.skipped_duplicates += 1;
        continue;
      }

      const matchedRate = rateById.get(item.rate_id);
      const bill = await Bill.create({
        society_id: societyId,
        flat_id: item.flat_id,
        title: `Maintenance ${requestedMonth}`,
        amount: item.amount,
        billing_month: requestedMonth,
        issue_date: finalIssueDate,
        due_date: finalDueDate,
        last_pay_date: finalDueDate,
        status: "PENDING",
        type: "MAINTENANCE",
        maintenance_rate_id: item.rate_id,
        financial_account_id: matchedRate?.financial_account_id || defaultBank?.id || null,
        calculation_details: item.calculation_details ? JSON.stringify(item.calculation_details) : null,
        late_fee_enabled: lateFeePolicy.is_enabled,
        late_fee_type: lateFeePolicy.is_enabled ? lateFeePolicy.fee_type : null,
        late_fee_value: lateFeePolicy.is_enabled ? lateFeePolicy.fee_amount : null,
        late_fee_grace_days: lateFeePolicy.is_enabled ? lateFeePolicy.grace_days : 0,
        late_fee_max_amount: lateFeePolicy.is_enabled ? lateFeePolicy.max_fee_amount : null,
      });

      results.push(bill);
      summary.generated += 1;

      // Queue notification to be sent asynchronously after response
      const targetUserId = item.resident_id;
      if (targetUserId && !notified.has(`${item.flat_id}:${targetUserId}`)) {
        notified.add(`${item.flat_id}:${targetUserId}`);
        notificationQueue.push({
          targetUserId,
          societyId,
          billId: bill.id,
          billAmount: bill.amount,
          requestedMonth,
          dueDate: due_date,
          flatId: item.flat_id,
        });
      }
    }

    await stampAudit({
      societyId,
      action: "MAINTENANCE_GENERATED",
      entityType: "MaintenanceRate",
      entityId: rates[0]?.id || null,
      newValue: { billing_month: requestedMonth, ...summary },
      reason: null,
      actor: req.user,
    });

    // Send HTTP response immediately so the UI closes the modal and reports success without blocking
    res.json({ summary, bills: results });

    // Send notifications in background so web/mobile modals close first before toasts/sockets trigger
    if (notificationQueue.length > 0) {
      setImmediate(async () => {
        for (const notifItem of notificationQueue) {
          try {
            const user = await User.findByPk(notifItem.targetUserId, { attributes: ["id", "fcm_token"] });
            if (user) {
              const settings = await UserSetting.findOne({ where: { user_id: user.id } });
              if (!settings || settings.payment_updates !== false) {
                const formattedDueDate = notifItem.dueDate
                  ? new Date(notifItem.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                  : null;
                const notifMsg = formattedDueDate
                  ? `Your maintenance bill of ₹${Number(notifItem.billAmount).toFixed(2)} for ${notifItem.requestedMonth} is now available. Due date: ${formattedDueDate}.`
                  : `Your maintenance bill of ₹${Number(notifItem.billAmount).toFixed(2)} for ${notifItem.requestedMonth} is now available.`;

                await notificationService.sendNotification({
                  societyId: notifItem.societyId,
                  receiverUserId: user.id,
                  receiverRole: "RESIDENT",
                  title: "New Maintenance Bill",
                  message: notifMsg,
                  type: "BILL",
                  actionType: "BILL_PAYMENT",
                  actionRoute: "/resident/bills",
                  fcmToken: user.fcm_token,
                  sourceEventId: `MAINTENANCE_BILL:${notifItem.billId}:${user.id}`,
                  extraData: { route: "/resident/bills", billId: notifItem.billId.toString() },
                });
              }
            }
          } catch (notifErr) {
            console.error(`[generateBills] Notification failed for flat ${notifItem.flatId}:`, notifErr.message);
          }
        }
      });
    }
  } catch (err) {
    console.error("[generateBills] error:", err);
    return res.status(400).json({ message: err.message || "Failed to generate maintenance bills" });
  }
};

/* ─────────────────────────────────────────
   LIST GENERATED MAINTENANCE BILLS
   GET /maintenance/bills
───────────────────────────────────────── */
const monthYearToDate = (s) => {
  if (!s) return null;
  const mm = String(s).trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!mm) return null;
  const month = new Date(`${mm[1]} 1, ${mm[2]}`).getMonth();
  if (Number.isNaN(month) || month < 0) return null;
  return new Date(Date.UTC(Number(mm[2]), month, 1));
};

const listBills = async (req, res) => {
  try {
    const {
      billing_month,
      status,
      from_month,
      to_month,
      from_date,
      to_date,
      date_field,
      maintenance_type,
      type: queryType,
      rate_id,
      maintenance_rate_id,
      flat_type,
    } = req.query;

    const where = { type: "MAINTENANCE" };
    const rateWhere = { society_id: req.user.society_id };

    let selectedType = maintenance_type || (queryType && queryType !== "MAINTENANCE" ? queryType : undefined);
    let selectedRateId = rate_id || maintenance_rate_id;

    if (selectedType && typeof selectedType === "string" && selectedType.startsWith("rate:")) {
      selectedRateId = Number(selectedType.replace("rate:", ""));
      selectedType = undefined;
    }

    if (selectedRateId) {
      where.maintenance_rate_id = selectedRateId;
    }

    if (selectedType) {
      if (["LUMPSUM", "SQ_FEET", "FLAT"].includes(selectedType)) {
        rateWhere.maintenance_type = selectedType;
      } else {
        rateWhere[Op.or] = [
          { maintenance_type: selectedType },
          { flat_type: selectedType },
          { name: selectedType },
        ];
      }
    }

    if (flat_type) {
      rateWhere.flat_type = flat_type;
    }

    if (billing_month) where.billing_month = billing_month;
    if (status) where.status = status;

    // Exact Day/Date range filter (e.g. YYYY-MM-DD)
    if (from_date || to_date) {
      const col = date_field === "due_date" ? "due_date" : "created_at";
      const dateRange = {};
      if (from_date) {
        const start = new Date(from_date);
        start.setHours(0, 0, 0, 0);
        dateRange[Op.gte] = start;
      }
      if (to_date) {
        const end = new Date(to_date);
        end.setHours(23, 59, 59, 999);
        dateRange[Op.lte] = end;
      }
      where[col] = dateRange;
    } else {
      // Month-Year range filter
      const fromDate = monthYearToDate(from_month);
      const toDate = monthYearToDate(to_month);
      if (fromDate || toDate) {
        const expr = Sequelize.fn("STR_TO_DATE", Sequelize.col("billing_month"), "%M %Y");
        const range = [];
        if (fromDate) range.push(Sequelize.where(expr, { [Op.gte]: fromDate }));
        if (toDate) range.push(Sequelize.where(expr, { [Op.lte]: toDate }));
        where[Op.and] = [...(where[Op.and] || []), ...range];
      }
    }

    const bills = await Bill.findAll({
      where,
      attributes: [
        "id",
        "flat_id",
        "title",
        "amount",
        "billing_month",
        "issue_date",
        "due_date",
        "status",
        "type",
        "maintenance_rate_id",
        "calculation_details",
        "late_fee_enabled",
        "late_fee_type",
        "late_fee_value",
        "late_fee_grace_days",
        "late_fee_max_amount",
        "created_at",
      ],
      include: [
        {
          model: MaintenanceRate,
          as: "rate",
          attributes: ["id", "name", "maintenance_type", "flat_type", "amount", "owner_amount", "tenant_amount", "rate_per_sqft", "owner_rate_per_sqft", "tenant_rate_per_sqft"],
          // Every maintenance bill must belong to a maintenance rate in the
          // logged-in society. Making this join required prevents legacy or
          // cross-society bills from appearing in the generated-bills tab.
          required: true,
          where: rateWhere,
        },
        {
          model: Flat,
          attributes: ["id", "flat_number", "flat_type", "block_id", "area_sqft"],
          include: [{ model: Block, attributes: ["id", "name"], required: false }],
          required: true,
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
          attributes: ["id", "amount", "base_amount", "late_fee_amount", "waived_amount", "status", "confirmed_at"],
        },
      ],
      order: [["created_at", "DESC"]],
    });
    const enriched = bills.map((bill) => {
      const plain = bill.toJSON();
      const settledPayment = (plain.Payments || []).find((p) => p.status === "SUCCESS") || null;
      return {
        ...plain,
        ...buildBillLateFeeFields(plain, {
          waivers: plain.lateFeeWaivers || [],
          settledPayment,
        }),
      };
    });
    return res.json(enriched);
  } catch (err) {
    console.error("[listBills]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   BILL DETAIL
   GET /maintenance/bills/:id
───────────────────────────────────────── */
const getBillDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const bill = await Bill.findOne({
      where: { id, type: "MAINTENANCE" },
      include: [{ model: Flat, attributes: ["id", "flat_number", "flat_type", "block_id", "area_sqft"] }],
    });

    if (!bill) return res.status(404).json({ message: "Maintenance bill not found" });

    const rate = await MaintenanceRate.findOne({
      where: { id: bill.maintenance_rate_id, society_id: req.user.society_id },
    });
    if (!rate) return res.status(404).json({ message: "Maintenance bill not found" });

    // Resolve current owner (responsible payer) via Bill -> Flat -> FlatMembership -> OWNER.
    let owner = null;
    const flat = bill.Flat
      ? await Flat.findOne({
          where: { id: bill.Flat.id },
          include: [
            {
              model: FlatMembership,
              required: true,
              where: { role: "OWNER", is_current: true, is_staying: true, pays_maintenance: true },
              include: [{ model: User, attributes: ["id", "name", "email", "phone"], required: false }],
            },
          ],
        })
      : null;

    if (flat && flat.FlatMemberships && flat.FlatMemberships.length > 0) {
      owner = flat.FlatMemberships[0];
    }

    const [waivers, payments] = await Promise.all([
      BillLateFeeWaiver.findAll({
        where: { bill_id: bill.id },
        include: [{ model: User, as: "waivedByUser", attributes: ["id", "name", "role"], required: false }],
        order: [["created_at", "DESC"]],
      }),
      Payment.findAll({
        where: { bill_id: bill.id },
        order: [["id", "DESC"]],
      }),
    ]);

    const settledPayment = payments.find((p) => p.status === "SUCCESS") || null;
    const lateFeeSummary = buildBillLateFeeFields(bill, { waivers, settledPayment });

    return res.json({
      bill: { ...bill.toJSON(), ...lateFeeSummary },
      rate,
      owner,
      waivers,
      lateFeeSummary,
    });
  } catch (err) {
    console.error("[getBillDetail]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   WAIVE LATE FEE ON A MAINTENANCE BILL
   POST /maintenance/bills/:billId/waive-late-fee
───────────────────────────────────────── */
const waiveLateFee = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const billId = Number(req.params.billId || req.params.id);
    const { waiver_amount, reason } = req.body || {};

    if (!Number.isInteger(billId) || billId <= 0) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid bill id." });
    }
    const cleanReason = String(reason || "").trim();
    if (!cleanReason) {
      await t.rollback();
      return res.status(400).json({ message: "Waiver reason is required." });
    }

    const parsedWaiver = Number(waiver_amount);
    if (!Number.isFinite(parsedWaiver) || parsedWaiver <= 0) {
      await t.rollback();
      return res.status(400).json({ message: "Waiver amount must be greater than 0." });
    }

    const bill = await Bill.findOne({
      where: { id: billId, type: "MAINTENANCE" },
      include: [{ model: Flat, include: [{ model: Block }] }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!bill) {
      await t.rollback();
      return res.status(404).json({ message: "Maintenance bill not found." });
    }

    const billSocietyId = bill.society_id || bill.Flat?.Block?.society_id;
    if (Number(billSocietyId) !== Number(req.user.society_id)) {
      await t.rollback();
      return res.status(403).json({ message: "Not authorized to waive late fee for this society's bill." });
    }

    if (bill.status === "PAID") {
      await t.rollback();
      return res.status(400).json({ message: "Cannot waive late fee on a bill that is already paid." });
    }
    if (bill.status === "PENDING_VERIFICATION") {
      await t.rollback();
      return res.status(400).json({ message: "Cannot waive late fee while payment verification is pending." });
    }

    const existingWaivers = await BillLateFeeWaiver.findAll({
      where: { bill_id: bill.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const beforeCalc = calculateLateFee(bill, { waivers: existingWaivers });
    if (beforeCalc.outstandingLateFee <= 0) {
      await t.rollback();
      return res.status(400).json({ message: "There is no outstanding late fee on this bill to waive." });
    }
    if (parsedWaiver > beforeCalc.outstandingLateFee) {
      await t.rollback();
      return res.status(400).json({
        message: `Waiver amount (₹${parsedWaiver}) cannot exceed outstanding late fee (₹${beforeCalc.outstandingLateFee}).`,
      });
    }

    const waiver = await BillLateFeeWaiver.create(
      {
        bill_id: bill.id,
        waiver_amount: parsedWaiver,
        reason: cleanReason,
        waived_by: req.user.id,
      },
      { transaction: t }
    );

    const allWaivers = [...existingWaivers, waiver];
    const afterSummary = buildBillLateFeeFields(bill, { waivers: allWaivers });

    await stampAudit({
      societyId: req.user.society_id,
      action: "BILL_LATE_FEE_WAIVED",
      entityType: "Bill",
      entityId: bill.id,
      oldValue: {
        late_fee: beforeCalc.outstandingLateFee,
        waived_amount: beforeCalc.waivedAmount,
        total_payable: beforeCalc.totalPayable,
      },
      newValue: {
        waiver_amount: parsedWaiver,
        reason: cleanReason,
        ...afterSummary,
      },
      reason: cleanReason,
      actor: req.user,
    });

    await t.commit();
    return res.status(201).json({
      message: "Late fee waived successfully.",
      waiver,
      summary: afterSummary,
    });
  } catch (err) {
    await t.rollback();
    console.error("[waiveLateFee]", err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getConfigs,
  saveConfig,
  deleteConfig,
  getLateFeeConfig,
  saveLateFeeConfig,
  generateBills,
  previewBills,
  listBills,
  getBillDetail,
  waiveLateFee,
  listFlatTypes,
};
