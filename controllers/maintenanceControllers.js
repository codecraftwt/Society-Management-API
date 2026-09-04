const { Op } = require("sequelize");
const MaintenanceRate = require("../models/MaintenanceRate");
const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const FlatMembership = require("../models/FlatMembership");
const User = require("../models/User");
const Notification = require("../models/Notification");
const UserSetting = require("../models/UserSetting");
const { sendPushNotification } = require("../utils/pushNotification");

const MAINTENANCE_TYPES = ["LUMPSUM", "SQ_FEET", "FLAT"];
const FLAT_TYPES = ["1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL"];
const RESIDENT_TYPES = ["OWNER", "TENANT"];
const FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"];

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
    if (!flat_type) return { error: "flat_type is required for FLAT maintenance" };
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
      order: [["maintenance_type", "ASC"], ["flat_type", "ASC"], ["id", "ASC"]],
    });
    return res.json(rates);
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

    // Validate FLAT configs against the flat types that actually exist in this society.
    if (data.maintenance_type === "FLAT") {
      const existingTypes = await getSocietyFlatTypes(req.user.society_id);
      if (!existingTypes.includes(data.flat_type)) {
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
      return res.json({
        message: "Configuration has been used by generated bills, so it was deactivated instead of deleted.",
        rate,
      });
    }

    await rate.destroy();
    return res.json({ message: "Configuration deleted", id: rate.id });
  } catch (err) {
    console.error("[deleteConfig]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   GENERATE MAINTENANCE BILLS
   POST /maintenance/generate
   Body: { billing_month?, rate_ids? }
   - Goes through each active rate of the society.
   - LUMPSUM / FLAT generate bills for eligible OWNER flats.
   - SQ_FEET cannot be generated (no area data) → reported as skipped.
───────────────────────────────────────── */
const generateBills = async (req, res) => {
  const societyId = req.user.society_id;
  const { billing_month, rate_ids } = req.body;

  const requestedMonth = billing_month || monthNameAndYear();
  const monthRegex = /^[A-Za-z]+\s\d{4}$/;
  if (!monthRegex.test(requestedMonth)) {
    return res.status(400).json({ message: "billing_month must be in format like 'September 2026'" });
  }

  const rateWhere = { society_id: societyId, is_active: true };
  if (Array.isArray(rate_ids) && rate_ids.length > 0) {
    rateWhere.id = { [Op.in]: rate_ids };
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
    attributes: ["id", "flat_number", "flat_type", "block_id", "occupancy_status"],
    include: [
      { model: Block, attributes: ["id", "name"], required: false, where: { society_id: societyId } },
      {
        model: FlatMembership,
        required: true,
        attributes: ["id", "user_id", "role"],
        where: {
          role: "OWNER",
          is_current: true,
          is_staying: true,
          pays_maintenance: true,
        },
      },
    ],
    order: [["id", "ASC"]],
  });
  if (eligibleFlats.length === 0) {
    return res.status(400).json({ message: "No eligible owner flats found to bill." });
  }

  const results = [];
  const summary = { generated: 0, skipped_duplicates: 0, skipped_sqft: 0, errors: [] };
  const notified = new Set();

  for (const rate of rates) {
    if (rate.maintenance_type === "SQ_FEET") {
      summary.skipped_sqft += 1;
      continue;
    }

    for (const flat of eligibleFlats) {
      if (rate.maintenance_type === "FLAT" && flat.flat_type !== rate.flat_type) continue;
      if (flat.occupancy_status === "RENTED") continue;

      const flatId = flat.id;
      const amount = Number(rate.amount);

      // Duplicate prevention: same flat + month + type + rate row.
      const existing = await Bill.count({
        where: {
          flat_id: flatId,
          billing_month: requestedMonth,
          type: "MAINTENANCE",
          maintenance_rate_id: rate.id,
        },
      });
      if (existing > 0) {
        summary.skipped_duplicates += 1;
        continue;
      }

      let calculation = null;
      let calculatedAmount = amount;

      if (rate.maintenance_type === "LUMPSUM") {
        calculation = { maintenance_type: "LUMPSUM", configured_amount: amount };
      } else if (rate.maintenance_type === "FLAT") {
        calculation = {
          maintenance_type: "FLAT",
          flat_type: rate.flat_type,
          configured_amount: amount,
        };
      }

      const bill = await Bill.create({
        flat_id: flatId,
        title: `Maintenance ${requestedMonth}`,
        amount: calculatedAmount,
        billing_month: requestedMonth,
        due_date: addDays(30),
        status: "PENDING",
        type: "MAINTENANCE",
        maintenance_rate_id: rate.id,
        calculation_details: calculation ? JSON.stringify(calculation) : null,
      });

      results.push(bill);
      summary.generated += 1;

      const membership = flat.FlatMemberships?.[0];
      if (!membership) continue;

      const targetUserId = membership.user_id;
      if (notified.has(`${flatId}:${targetUserId}`)) continue;
      notified.add(`${flatId}:${targetUserId}`);

      const user = await User.findByPk(targetUserId, { attributes: ["id", "fcm_token"] });
      if (!user) {
        summary.errors.push(`Could not reload owner for flat ${flatId}`);
        continue;
      }

      const settings = await UserSetting.findOne({ where: { user_id: user.id } });
      if (settings && settings.payment_updates === false) continue;

      const notification = await Notification.create({
        title: "New Maintenance Bill",
        message: `Your maintenance bill of ₹${Number(bill.amount).toFixed(2)} for ${requestedMonth} is now available.`,
        type: "BILL",
        action_type: "BILL_PAYMENT",
        action_route: "/resident/bills",
        society_id: societyId,
        receiver_role: "RESIDENT",
        receiver_user_id: user.id,
      });
      if (global.io) {
        global.io.to(`user_${user.id}`).emit("new_notification", notification);
      }
      if (user.fcm_token) {
        sendPushNotification(
          user.fcm_token,
          "New Maintenance Bill",
          `A new bill of ₹${Number(bill.amount).toFixed(2)} for ${requestedMonth} has been generated.`,
          { route: "/resident/bills", billId: bill.id.toString() }
        ).catch((err) => console.error("Push Error:", err));
      }
    }
  }

  return res.json({ summary, bills: results });
};

/* ─────────────────────────────────────────
   LIST GENERATED MAINTENANCE BILLS
   GET /maintenance/bills
───────────────────────────────────────── */
const listBills = async (req, res) => {
  try {
    const { billing_month, status } = req.query;
    const where = { type: "MAINTENANCE" };
    const rateWhere = { society_id: req.user.society_id };

    if (billing_month) where.billing_month = billing_month;
    if (status) where.status = status;

    const bills = await Bill.findAll({
      where,
      attributes: ["id", "flat_id", "title", "amount", "billing_month", "due_date", "status", "type", "maintenance_rate_id", "calculation_details", "created_at"],
      include: [
        {
          model: MaintenanceRate,
          as: "rate",
          attributes: ["id", "name", "maintenance_type", "flat_type", "amount", "rate_per_sqft"],
          required: true,
          where: rateWhere,
        },
        {
          model: Flat,
          attributes: ["id", "flat_number", "flat_type", "block_id"],
          include: [{ model: Block, attributes: ["id", "name"], required: false }],
          required: true,
        },
      ],
      order: [["created_at", "DESC"]],
    });
    return res.json(bills);
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
      include: [{ model: Flat, attributes: ["id", "flat_number", "flat_type", "block_id"] }],
    });

    if (!bill) return res.status(404).json({ message: "Maintenance bill not found" });

    const rate = await MaintenanceRate.findOne({
      where: { id: bill.maintenance_rate_id },
    });

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
              include: [{ model: User, attributes: ["id", "name", "email", "mobile"], required: false }],
            },
          ],
        })
      : null;

    if (flat && flat.FlatMemberships && flat.FlatMemberships.length > 0) {
      owner = flat.FlatMemberships[0];
    }

    return res.json({ bill, rate, owner });
  } catch (err) {
    console.error("[getBillDetail]", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getConfigs,
  saveConfig,
  deleteConfig,
  generateBills,
  listBills,
  getBillDetail,
  listFlatTypes,
};
