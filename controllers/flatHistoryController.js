const { Flat, User, Bill, Complaint, Parcel, ParkingRequest } = require("../models");
const ResidentHistory = require("../models/ResidentHistory");
const FlatMembership = require("../models/FlatMembership");
const { recalcOccupancyStatus } = require("./flatMembershipController");
const { ensureAssignable } = require("../utils/approvalGuard");
const { Op } = require("sequelize");

// 🔍 Check whether a resident can be moved out or has pending clearance issues
const getMoveOutClearanceIssues = async (flat_id, user_id) => {
  const issues = [];
  const details = {
    pendingBills: [],
    openComplaints: [],
    pendingParcels: [],
    pendingParkingRequests: [],
  };

  // 1. Pending/unpaid bills on this flat
  const pendingBills = await Bill.findAll({
    where: {
      flat_id,
      status: { [Op.notIn]: ["PAID", "paid"] },
    },
    attributes: ["id", "title", "amount", "status", "due_date", "billing_month"],
  });

  if (pendingBills.length > 0) {
    const totalPendingAmount = pendingBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
    issues.push(`${pendingBills.length} unpaid bill(s) totaling ₹${totalPendingAmount.toLocaleString("en-IN")}`);
    details.pendingBills = pendingBills;
  }

  // 2. Open complaints on this flat or logged by this resident
  const openComplaints = await Complaint.findAll({
    where: {
      [Op.or]: [
        { flat_id, status: { [Op.in]: ["OPEN", "IN_PROGRESS"] } },
        ...(user_id ? [{ resident_id: user_id, status: { [Op.in]: ["OPEN", "IN_PROGRESS"] } }] : []),
      ],
    },
    attributes: ["id", "title", "status", "created_at"],
  });

  if (openComplaints.length > 0) {
    issues.push(`${openComplaints.length} open/in-progress complaint(s)`);
    details.openComplaints = openComplaints;
  }

  // 3. Undelivered / at-gate parcels for this flat
  const pendingParcels = await Parcel.findAll({
    where: {
      flat_id,
      status: { [Op.in]: ["EXPECTED", "AT_GATE"] },
    },
    attributes: ["id", "courier_name", "status", "entry_time"],
  });

  if (pendingParcels.length > 0) {
    issues.push(`${pendingParcels.length} undelivered parcel(s) at gate/expected`);
    details.pendingParcels = pendingParcels;
  }

  // 4. Pending parking requests for this flat or resident
  const pendingParking = await ParkingRequest.findAll({
    where: {
      [Op.or]: [
        { flat_id, status: "PENDING" },
        ...(user_id ? [{ resident_id: user_id, status: "PENDING" }] : []),
      ],
    },
    attributes: ["id", "guest_name", "vehicle_number", "status"],
  });

  if (pendingParking.length > 0) {
    issues.push(`${pendingParking.length} pending parking request(s)`);
    details.pendingParkingRequests = pendingParking;
  }

  return {
    canMoveOut: issues.length === 0,
    issues,
    details,
  };
};

const checkMoveOutClearance = async (req, res) => {
  try {
    const { flat_id, user_id } = req.params;
    if (!flat_id) {
      return res.status(400).json({ message: "flat_id is required" });
    }
    const clearance = await getMoveOutClearanceIssues(flat_id, user_id);
    return res.json(clearance);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


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

    // 0. Clearance Gate: Must clear pending bills, complaints, parcels, and parking requests before moving out
    const clearance = await getMoveOutClearanceIssues(flat_id, user_id);
    if (!clearance.canMoveOut) {
      return res.status(400).json({
        message: `Cannot mark resident as moved out. Please clear all pending items first: ${clearance.issues.join("; ")}`,
        canMoveOut: false,
        issues: clearance.issues,
        details: clearance.details,
      });
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
    // not keep treating a moved-out resident as the current occupant.
    const today = new Date().toISOString().slice(0, 10);
    const departingMemberships = await FlatMembership.findAll({
      where: { flat_id, user_id, is_current: true },
    });
    for (const departingMembership of departingMemberships) {
      await departingMembership.update({
        is_current: false,
        is_staying: false,
        move_out_date: today,
      });
    }

    if (departingType === "TENANT") {
      const ownerMembership = await FlatMembership.findOne({
        where: { flat_id, role: "OWNER", is_current: true },
      });
      if (ownerMembership) await ownerMembership.update({ is_staying: true });
    }

    // Release any parking slots assigned to this resident for this flat
    try {
      const ParkingSlot = require("../models/ParkingSlot");
      if (ParkingSlot) {
        await ParkingSlot.update(
          { resident_id: null, flat_id: null, status: "AVAILABLE" },
          { where: { flat_id, resident_id: user_id, status: "ASSIGNED" } }
        );
      }
    } catch (_) {}

    // Keep the flat's primary pointer on the remaining current owner, if any.
    let remainingOwner = await ResidentHistory.findOne({
      where: { flat_id, is_current: true },
      include: [{ model: User, where: { resident_type: "OWNER" }, attributes: ["id", "resident_type"] }],
      order: [["move_in_date", "ASC"]],
    });

    let activeResidentId = remainingOwner?.user_id || null;

    // Also check FlatMembership for the active owner
    if (!activeResidentId) {
      const activeOwnerMembership = await FlatMembership.findOne({
        where: { flat_id, role: "OWNER", is_current: true },
      });
      if (activeOwnerMembership) {
        activeResidentId = activeOwnerMembership.user_id;
      }
    }

    if (!activeResidentId && departingType === "TENANT") {
      const ownerHistory = await ResidentHistory.findOne({
        where: { flat_id },
        include: [{ model: User, where: { resident_type: "OWNER" }, attributes: ["id", "resident_type"] }],
        order: [["move_out_date", "DESC"], ["move_in_date", "DESC"]],
      });
      if (ownerHistory) {
        activeResidentId = ownerHistory.user_id;
      }
    }

    // Ensure the reinstated owner has an active ResidentHistory record
    if (activeResidentId) {
      const existingHistory = await ResidentHistory.findOne({
        where: { flat_id, user_id: activeResidentId, is_current: true },
      });
      if (!existingHistory) {
        await ResidentHistory.create({
          flat_id,
          user_id: activeResidentId,
          move_in_date: new Date(),
          is_current: true,
        });
      }

      await FlatMembership.update(
        { is_staying: true },
        { where: { flat_id, user_id: activeResidentId, is_current: true } }
      );
    }

    // 2. Point flat resident to the reinstated primary owner
    await Flat.update(
      {
        resident_id: activeResidentId,
        occupancy_status: activeResidentId ? "OWNER_OCCUPIED" : "VACANT",
      },
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

    // Auto-reconcile stale FlatMemberships where ResidentHistory shows the resident already moved out
    const todayIso = new Date().toISOString().slice(0, 10);
    for (const m of memberships) {
      const pastHistory = history.find(
        (h) => Number(h.user_id) === Number(m.user_id) && !h.is_current && h.move_out_date
      );
      const activeHistory = history.find(
        (h) => Number(h.user_id) === Number(m.user_id) && h.is_current
      );
      if (pastHistory && !activeHistory) {
        await m.update({
          is_current: false,
          is_staying: false,
          move_out_date: pastHistory.move_out_date
            ? new Date(pastHistory.move_out_date).toISOString().slice(0, 10)
            : todayIso,
        });
      }
    }

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
  checkMoveOutClearance,
  getMoveOutClearanceIssues,
};
