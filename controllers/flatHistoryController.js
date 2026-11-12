const { Flat, User } = require("../models");
const ResidentHistory = require("../models/ResidentHistory");
const FlatMembership = require("../models/FlatMembership");
const { recalcOccupancyStatus } = require("./flatMembershipController");
const { ensureAssignable } = require("../utils/approvalGuard");


// 🟢 MOVE-IN (assign new resident)
const moveInResident = async (req, res) => {
  try {
    const { flat_id, user_id } = req.body || {};

    if (!flat_id || !user_id) {
      return res.status(400).json({ message: "flat_id and user_id are required" });
    }

    // A rejected registration must never be moved into a flat.
    const assignable = await ensureAssignable(user_id);
    if (!assignable.ok) return res.status(assignable.status).json(assignable.payload);

    const incomingUser = await User.findByPk(user_id, { attributes: ["resident_type", "society_id"] });
    const incomingType = String(incomingUser?.resident_type || "OWNER").toUpperCase();

    // Owners and tenants can occupy the same flat at the same time. Only
    // replace an existing resident of the same type during move-in.
    const currentResidents = await ResidentHistory.findAll({
      where: { flat_id, is_current: true },
      include: [{ model: User, attributes: ["id", "resident_type"] }],
    });
    for (const current of currentResidents) {
      const currentType = String(current.User?.resident_type || "OWNER").toUpperCase();
      const shouldClose = current.user_id !== user_id && (
        currentType === incomingType || (incomingType === "TENANT" && currentType === "OWNER")
      );
      if (shouldClose) {
        await current.update({ move_out_date: new Date(), is_current: false });
      }
    }

    // 2. Add new resident history
    const history = await ResidentHistory.create({
      flat_id,
      user_id,
      move_in_date: new Date(),
      is_current: true,
    });

    // 3. Update Flat current resident
    await Flat.update(
      {
        resident_id: user_id,
        occupancy_status: incomingType === "TENANT" ? "RENTED" : "OWNER_OCCUPIED",
      },
      { where: { id: flat_id } }
    );

    // 4. Update / create FlatMembership
    const today = new Date().toISOString().slice(0, 10);
    await FlatMembership.update(
      { is_current: false, move_out_date: today },
      { where: { flat_id, role: incomingType, is_current: true } }
    );
    await FlatMembership.create({
      flat_id,
      user_id,
      society_id: incomingUser?.society_id || null,
      role: incomingType,
      is_staying: true,
      pays_maintenance: true,
      move_in_date: today,
      is_current: true,
    });

    await recalcOccupancyStatus(flat_id);

    res.status(201).json({
      message: "Resident moved in successfully",
      history,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// 🔴 MOVE-OUT (remove resident)
const moveOutResident = async (req, res) => {
  try {
    const { flat_id, user_id } = req.body || {};

    if (!flat_id || !user_id) {
      return res.status(400).json({ message: "flat_id and user_id are required" });
    }

    const departingUser = await User.findByPk(user_id, { attributes: ["resident_type"] });
    const departingType = String(departingUser?.resident_type || "OWNER").toUpperCase();

    // 1. Update history
    await ResidentHistory.update(
      {
        move_out_date: new Date(),
        is_current: false,
      },
      {
        where: {
          flat_id,
          user_id,
          is_current: true,
        },
      }
    );

    // Close the matching membership so occupancy and gate-pass eligibility do
    // not keep treating a moved-out tenant as the current occupant.
    const today = new Date().toISOString().slice(0, 10);
    const departingMembership = await FlatMembership.findOne({
      where: { flat_id, user_id, is_current: true },
    });
    if (departingMembership) {
      if (departingMembership.role === "TENANT") {
        await departingMembership.update({
          is_current: false,
          is_staying: false,
          move_out_date: today,
        });
        const ownerMembership = await FlatMembership.findOne({
          where: { flat_id, role: "OWNER", is_current: true },
        });
        if (ownerMembership) await ownerMembership.update({ is_staying: true });
      } else {
        await departingMembership.update({ is_staying: false });
      }
    }

    // Keep the flat's primary pointer on the remaining current owner, if any.
    const remainingOwner = await ResidentHistory.findOne({
      where: { flat_id, is_current: true },
      include: [{ model: User, attributes: ["id", "resident_type"] }],
      order: [["move_in_date", "ASC"]],
    });

    let activeResidentId = remainingOwner?.user_id || null;
    if (!remainingOwner && departingType === "TENANT") {
      const ownerHistory = await ResidentHistory.findOne({
        where: { flat_id },
        include: [{ model: User, where: { resident_type: "OWNER" }, attributes: ["id", "resident_type"] }],
        order: [["move_out_date", "DESC"], ["move_in_date", "DESC"]],
      });
      if (ownerHistory) {
        await ResidentHistory.create({
          flat_id,
          user_id: ownerHistory.user_id,
          move_in_date: new Date(),
          is_current: true,
        });
        activeResidentId = ownerHistory.user_id;
      }
    }

    if (activeResidentId) {
      await FlatMembership.update(
        { is_staying: true },
        { where: { flat_id, user_id: activeResidentId, is_current: true } }
      );
    }

    // 2. Remove the departing resident from the flat pointer only when no
    // other current resident remains.
    await Flat.update(
      { resident_id: activeResidentId },
      { where: { id: flat_id } }
    );

    await recalcOccupancyStatus(flat_id);

    res.json({
      message: "Resident moved out successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// 📜 GET FULL FLAT HISTORY (With self-healing and membership reconciliation)
const getFlatHistory = async (req, res) => {
  try {
    const { flat_id } = req.params;

    let history = await ResidentHistory.findAll({
      where: { flat_id },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "approval_status", "resident_type"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    // Query flat and active memberships to auto-heal missing history records
    const flat = await Flat.findByPk(flat_id, {
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "approval_status", "resident_type"],
        },
      ],
    });

    const memberships = await FlatMembership.findAll({
      where: { flat_id, is_current: true },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "approval_status", "resident_type"],
        },
      ],
    });

    const existingUserIds = new Set(
      history
        .filter((h) => h.User && h.User.approval_status !== "REJECTED")
        .map((h) => Number(h.user_id))
    );

    let needsRefetch = false;

    // Auto-heal from active FlatMemberships
    for (const m of memberships) {
      if (m.user_id && m.User && m.User.approval_status !== "REJECTED" && !existingUserIds.has(Number(m.user_id))) {
        await ResidentHistory.create({
          flat_id,
          user_id: m.user_id,
          move_in_date: m.move_in_date || m.created_at || new Date(),
          is_current: true,
        });
        existingUserIds.add(Number(m.user_id));
        needsRefetch = true;
      }
    }

    // Auto-heal from Flat.resident_id
    if (flat?.resident_id && flat?.User && flat.User.approval_status !== "REJECTED" && !existingUserIds.has(Number(flat.resident_id))) {
      await ResidentHistory.create({
        flat_id,
        user_id: flat.resident_id,
        move_in_date: flat.created_at || new Date(),
        is_current: true,
      });
      existingUserIds.add(Number(flat.resident_id));
      needsRefetch = true;
    }

    if (needsRefetch) {
      history = await ResidentHistory.findAll({
        where: { flat_id },
        include: [
          {
            model: User,
            attributes: ["id", "name", "email", "phone", "approval_status", "resident_type"],
          },
        ],
        order: [["created_at", "DESC"]],
      });
    }

    // Clean up orphaned records in DB where user_id no longer exists or user is null
    const orphanedIds = history
      .filter((h) => !h.User || !h.User.name || h.User.name.toLowerCase() === "unknown")
      .map((h) => h.id);

    if (orphanedIds.length > 0) {
      await ResidentHistory.destroy({ where: { id: orphanedIds } });
    }

    const membershipRoleMap = new Map();
    for (const m of memberships) {
      if (m.user_id) membershipRoleMap.set(Number(m.user_id), m.role);
    }

    const filteredHistory = history
      .filter(
        (h) =>
          h.User &&
          h.User.name &&
          h.User.name.toLowerCase() !== "unknown" &&
          h.User.approval_status !== "REJECTED"
      )
      .map((h) => {
        const plain = h.toJSON ? h.toJSON() : { ...h };
        const role = membershipRoleMap.get(Number(plain.user_id)) || plain.User?.resident_type || "OWNER";
        return {
          ...plain,
          role,
          resident_type: role,
        };
      });

    res.json(filteredHistory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  moveInResident,
  moveOutResident,
  getFlatHistory,
};
