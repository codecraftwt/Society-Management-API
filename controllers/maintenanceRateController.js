const MaintenanceRate = require("../models/MaintenanceRate");

const FLAT_TYPES = ["1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL"];
const RESIDENT_TYPES = ["OWNER", "TENANT"];

/* ─────────────────────────────────────────
   GET RATES
   GET /rates
   Returns all maintenance rates for the authenticated user's society.
───────────────────────────────────────── */
const getRates = async (req, res) => {
  try {
    const rates = await MaintenanceRate.findAll({
      where: { society_id: req.user.society_id },
      order: [
        ["flat_type", "ASC"],
        ["resident_type", "ASC"],
      ],
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
   Body: { flat_type, resident_type, amount }
   findOrCreate pattern — creates a new rate or updates existing one.
───────────────────────────────────────── */
const upsertRate = async (req, res) => {
  try {
    const { flat_type, resident_type, amount } = req.body;

    if (!flat_type || !resident_type || amount === undefined) {
      return res
        .status(400)
        .json({ message: "flat_type, resident_type, and amount are required" });
    }
    if (!FLAT_TYPES.includes(flat_type)) {
      return res.status(400).json({ message: `flat_type must be one of: ${FLAT_TYPES.join(", ")}` });
    }
    if (!RESIDENT_TYPES.includes(resident_type)) {
      return res.status(400).json({ message: `resident_type must be OWNER or TENANT` });
    }
    if (isNaN(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({ message: "amount must be a non-negative number" });
    }

    const [rate, created] = await MaintenanceRate.findOrCreate({
      where: {
        society_id: req.user.society_id,
        flat_type,
        resident_type,
      },
      defaults: {
        society_id: req.user.society_id,
        flat_type,
        resident_type,
        amount: Number(amount),
      },
    });

    if (!created) {
      await rate.update({ amount: Number(amount) });
    }

    return res.status(created ? 201 : 200).json({
      rate,
      action: created ? "created" : "updated",
    });
  } catch (err) {
    console.error("[upsertRate]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   UPSERT MANY RATES (batch save from RateCard UI)
   POST /rates/batch
   Body: { rates: [{ flat_type, resident_type, amount }, ...] }
───────────────────────────────────────── */
const upsertRates = async (req, res) => {
  try {
    const { rates } = req.body;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ message: "rates array is required" });
    }

    const results = [];
    for (const entry of rates) {
      const { flat_type, resident_type, amount } = entry;
      if (!flat_type || !resident_type || amount === undefined) continue;

      const [rate, created] = await MaintenanceRate.findOrCreate({
        where: {
          society_id: req.user.society_id,
          flat_type,
          resident_type,
        },
        defaults: {
          society_id: req.user.society_id,
          flat_type,
          resident_type,
          amount: Number(amount),
        },
      });

      if (!created) await rate.update({ amount: Number(amount) });
      results.push({ flat_type, resident_type, amount: Number(amount), action: created ? "created" : "updated" });
    }

    return res.json({ saved: results });
  } catch (err) {
    console.error("[upsertRates]", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getRates, upsertRate, upsertRates };