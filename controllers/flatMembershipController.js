


// Society_Management_API/controllers/flatMembershipController.js
const { Op } = require("sequelize");
const FlatMembership = require("../models/FlatMembership");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const User = require("../models/User");

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
async function recalcOccupancyStatus(flatId) {
  const active = await FlatMembership.findAll({
    where: { flat_id: flatId, is_current: true },
  });

  const tenantStaying = active.some(
    (m) => m.role === "TENANT" && m.is_staying
  );
  const ownerStaying = active.some(
    (m) => m.role === "OWNER" && m.is_staying
  );

  let status = "VACANT";
  if (tenantStaying) status = "RENTED";
  else if (ownerStaying) status = "OWNER_OCCUPIED";

  await Flat.update({ occupancy_status: status }, { where: { id: flatId } });
  return status;
}

const FLAT_INCLUDE = [
  {
    model: Floor,
    required: false,
    attributes: ["id", "floor_number"],
    include: [{ model: Block, required: false, attributes: ["id", "name"] }],
  },
  { model: Block, required: false, attributes: ["id", "name"] },
];

/* ─────────────────────────────────────────
   1. CREATE MEMBERSHIP
───────────────────────────────────────── */
const createMembership = async (req, res) => {
  try {
    const { flatId } = req.params;
    const {
      user_id,
      role,
      is_staying = true,
      pays_maintenance = true,
      move_in_date = null,
    } = req.body;

    if (!user_id || !role) {
      return res.status(400).json({ message: "user_id and role are required" });
    }
    if (!["OWNER", "TENANT"].includes(role)) {
      return res.status(400).json({ message: "role must be OWNER or TENANT" });
    }

    const flat = await Flat.findByPk(flatId);
    if (!flat) return res.status(404).json({ message: "Flat not found" });

    const existing = await FlatMembership.findOne({
      where: { flat_id: flatId, role, is_current: true },
    });
    if (existing) {
      await existing.update({
        is_current: false,
        move_out_date: new Date().toISOString().slice(0, 10),
      });
    }

    const membership = await FlatMembership.create({
      flat_id: flatId,
      user_id,
      role,
      is_staying,
      pays_maintenance,
      move_in_date,
      is_current: true,
    });

    const occupancy_status = await recalcOccupancyStatus(flatId);

    const full = await FlatMembership.findByPk(membership.id, {
      include: [{ model: User, attributes: ["id", "name", "email", "phone", "resident_type"] }],
    });

    return res.status(201).json({ membership: full, occupancy_status });
  } catch (err) {
    console.error("[createMembership]", err);
    res.status(500).json({ message: err.message });
  }
};



/* ─────────────────────────────────────────
   2. GET MEMBERSHIPS FOR FLAT
───────────────────────────────────────── */
const getMembershipsForFlat = async (req, res) => {
  try {
    const { flatId } = req.params;
    const { all } = req.query;

    const where = { flat_id: flatId };
    if (!all) where.is_current = true;

    const memberships = await FlatMembership.findAll({
      where,
      include: [
        {
          model: User,
          attributes: [
            "id", "name", "email", "phone", "resident_type", "approval_status", "rejection_reason" // ✅ ADDED rejection_reason HERE
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const flat = await Flat.findByPk(flatId, {
      attributes: ["id", "flat_number", "flat_type", "occupancy_status"],
      include: FLAT_INCLUDE,
    });

    return res.json({ flat, memberships });
  } catch (err) {
    console.error("[getMembershipsForFlat]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   3. GET MEMBERSHIPS FOR USER
───────────────────────────────────────── */
const getMembershipsForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { all } = req.query;

    const where = { user_id: userId };
    if (!all) where.is_current = true;

    const memberships = await FlatMembership.findAll({
      where,
      include: [
        {
          model: Flat,
          attributes: ["id", "flat_number", "flat_type", "occupancy_status", "floor_id", "block_id"],
          include: FLAT_INCLUDE,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const owned = memberships.filter((m) => m.role === "OWNER");
    const rented = memberships.filter((m) => m.role === "TENANT");

    return res.json({ owned, rented, all: memberships });
  } catch (err) {
    console.error("[getMembershipsForUser]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   4. END MEMBERSHIP
───────────────────────────────────────── */
const endMembership = async (req, res) => {
  try {
    const { id } = req.params;

    const membership = await FlatMembership.findByPk(id);
    if (!membership) return res.status(404).json({ message: "Membership not found" });
    if (!membership.is_current) return res.status(400).json({ message: "Membership is already ended" });

    await membership.update({
      is_current: false,
      move_out_date: new Date().toISOString().slice(0, 10),
    });

    const occupancy_status = await recalcOccupancyStatus(membership.flat_id);

    return res.json({ message: "Membership ended successfully", occupancy_status });
  } catch (err) {
    console.error("[endMembership]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────
   5. UPDATE MEMBERSHIP
───────────────────────────────────────── */
const updateMembership = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_staying, pays_maintenance, role } = req.body;

    const membership = await FlatMembership.findByPk(id);
    if (!membership) return res.status(404).json({ message: "Membership not found" });

    const updates = {};
    if (is_staying !== undefined) updates.is_staying = is_staying;
    if (pays_maintenance !== undefined) updates.pays_maintenance = pays_maintenance;
    if (role && ["OWNER", "TENANT"].includes(role)) updates.role = role;

    await membership.update(updates);

    const occupancy_status = await recalcOccupancyStatus(membership.flat_id);

    const full = await FlatMembership.findByPk(id, {
      include: [{ model: User, attributes: ["id", "name", "email", "phone"] }],
    });

    return res.json({ membership: full, occupancy_status });
  } catch (err) {
    console.error("[updateMembership]", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createMembership,
  getMembershipsForFlat,
  getMembershipsForUser,
  endMembership,
  updateMembership,
  recalcOccupancyStatus,
};