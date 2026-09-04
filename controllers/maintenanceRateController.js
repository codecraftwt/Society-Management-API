const MaintenanceRate = require("../models/MaintenanceRate");

const MAINTENANCE_TYPES = ["LUMPSUM", "SQ_FEET", "FLAT"];
const FLAT_TYPES = ["1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL"];
const RESIDENT_TYPES = ["OWNER", "TENANT"];
const FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"];

/* Shared validation used by single + batch upsert helpers. */
function normalizeRateInput(body, society_id) {
  const {
    maintenance_type,
    name,
    flat_type,
    resident_type,
    amount,
    rate_per_sqft,
    frequency,
    description,
    is_active,
  } = body;

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
    if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
      return { error: "amount is required and must be a non-negative number for LUMPSUM" };
    }
  } else if (maintenance_type === "SQ_FEET") {
    if (rate_per_sqft === undefined || rate_per_sqft === null || isNaN(Number(rate_per_sqft)) || Number(rate_per_sqft) < 0) {
      return { error: "rate_per_sqft is required and must be a non-negative number for SQ_FEET" };
    }
  } else if (maintenance_type === "FLAT") {
    if (!flat_type) {
      return { error: "flat_type is required for FLAT maintenance" };
    }
    if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
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
      rate_per_sqft: maintenance_type === "SQ_FEET" ? Number(rate_per_sqft) : (rate_per_sqft !== undefined && rate_per_sqft !== null ? Number(rate_per_sqft) : null),
      frequency: frequency || "MONTHLY",
      description: (description || "").toString().trim() || null,
      is_active: is_active === undefined ? true : !!is_active,
    },
  };
}

/* ─────────────────────────────────────────
   GET RATES
   GET /rates
   Returns all maintenance rates for the authenticated user's society.
───────────────────────────────────────── */
const getRates = async (req, res) => {
  try {
    const rates = await MaintenanceRate.findAll({
      where: { society_id: req.user.society_id },
      order: [["maintenance_type", "ASC"], ["flat_type", "ASC"]],
    });
    return res.json(rates);
  } catch (err) {
    console.error("[getRates]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   UPSERT RATE
   POST /rates
   Body: { maintenance_type, name, amount | rate_per_sqft, flat_type, frequency, ... }
   Creates a new rate or updates the matching one.
───────────────────────────────────────── */
const upsertRate = async (req, res) => {
  try {
    const { error, data } = normalizeRateInput(req.body, req.user.society_id);
    if (error) return res.status(400).json({ message: error });

    const { maintenance_type, flat_type, resident_type, ...rest } = data;

    const where = { society_id: req.user.society_id, maintenance_type };
    if (flat_type) where.flat_type = flat_type;
    if (resident_type) where.resident_type = resident_type;

    const [rate, created] = await MaintenanceRate.findOrCreate({
      where,
      defaults: data,
    });

    if (!created) {
      await rate.update(data);
    }

    return res.status(created ? 201 : 200).json({ rate, action: created ? "created" : "updated" });
  } catch (err) {
    console.error("[upsertRate]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   UPSERT MANY RATES
   POST /rates/batch
   Body: { rates: [{ maintenance_type, name, amount | rate_per_sqft, flat_type, ... }, ...] }
───────────────────────────────────────── */
const upsertRates = async (req, res) => {
  try {
    const { rates } = req.body;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ message: "rates array is required" });
    }

    const results = [];
    for (const entry of rates) {
      const { error, data } = normalizeRateInput(entry, req.user.society_id);
      if (error) continue;

      const { maintenance_type, flat_type, resident_type, ...rest } = data;

      const where = { society_id: req.user.society_id, maintenance_type };
      if (flat_type) where.flat_type = flat_type;
      if (resident_type) where.resident_type = resident_type;

      const [rate, created] = await MaintenanceRate.findOrCreate({ where, defaults: data });
      if (!created) await rate.update(data);
      results.push({ ...data, id: rate.id, action: created ? "created" : "updated" });
    }

    return res.json({ saved: results });
  } catch (err) {
    console.error("[upsertRates]", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getRates, upsertRate, upsertRates };
