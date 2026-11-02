const { Op } = require("sequelize");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const Block = require("../models/Block");
const Flat = require("../models/Flat");
const ParkingSlot = require("../models/ParkingSlot");
const FlatMembership = require("../models/FlatMembership");

/**
 * Normalizes property types from Block.property_type
 */
const isApartmentType = (type) => {
  if (!type) return true; // Default in Block schema is "Apartments"
  const upper = String(type).trim().toUpperCase();
  return upper === "APARTMENT" || upper === "APARTMENTS";
};

const isRowHouseType = (type) => {
  if (!type) return false;
  const upper = String(type).trim().toUpperCase();
  return (
    upper === "ROW_HOUSE" ||
    upper === "ROW HOUSE" ||
    upper === "ROW HOUSES" ||
    upper === "ROWHOUSE"
  );
};

const getAllStat = async (req, res) => {
  try {
    const societyId =
      req.user.activeRole === "SUPER_ADMIN" &&
      (req.headers["x-society-id"] || req.query.society_id)
        ? req.headers["x-society-id"] || req.query.society_id
        : req.user.society_id;

    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    // 1. Fetch all users in the society
    const allUsers = await User.findAll({
      where: { society_id: societyId },
      attributes: ["id", "email", "role", "roles"],
    });

    // 2. Count registered residents matching the resident management logic
    const residentUsers = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try {
          rList = JSON.parse(u.roles);
        } catch (e) {
          rList = [];
        }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }
      return rList.includes("RESIDENT");
    });

    const emailMap = new Map();
    residentUsers.forEach((user) => {
      const key = user.email ? user.email.toLowerCase().trim() : user.id;
      if (!emailMap.has(key)) emailMap.set(key, true);
    });
    const residents = emailMap.size;

    // 3. Count guards
    const guards = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try {
          rList = JSON.parse(u.roles);
        } catch (e) {
          rList = [];
        }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }
      return rList.includes("GUARD");
    }).length;

    // 4. Count flats and occupancy breakdown for all blocks in the society
    const blocks = await Block.findAll({
      where: { society_id: societyId },
      attributes: ["id", "property_type"],
    });
    const blockMap = new Map();
    blocks.forEach((b) => blockMap.set(b.id, b.property_type));
    const blockIds = blocks.map((b) => b.id);

    const allFlats =
      blockIds.length > 0
        ? await Flat.findAll({
            where: { block_id: { [Op.in]: blockIds } },
            attributes: ["id", "block_id", "occupancy_status", "resident_id"],
          })
        : [];

    const flatIds = allFlats.map((f) => f.id);

    // Active memberships verify current physical occupancy
    let occupiedFlatIdsFromMembership = new Set();
    if (flatIds.length > 0) {
      try {
        const activeMemberships = await FlatMembership.findAll({
          where: { flat_id: { [Op.in]: flatIds }, is_current: true },
          attributes: ["flat_id"],
        });
        occupiedFlatIdsFromMembership = new Set(
          activeMemberships.map((m) => m.flat_id)
        );
      } catch (err) {
        console.warn("[infoController] FlatMembership query fallback:", err.message);
      }
    }

    let aptTotal = 0;
    let aptOccupied = 0;
    let rowTotal = 0;
    let rowOccupied = 0;
    let otherTotal = 0;
    let otherOccupied = 0;

    allFlats.forEach((f) => {
      const propType = blockMap.get(f.block_id) || "Apartments";
      const isOccupied =
        f.occupancy_status === "RENTED" ||
        f.occupancy_status === "OWNER_OCCUPIED" ||
        f.resident_id !== null ||
        occupiedFlatIdsFromMembership.has(f.id);

      if (isApartmentType(propType)) {
        aptTotal++;
        if (isOccupied) aptOccupied++;
      } else if (isRowHouseType(propType)) {
        rowTotal++;
        if (isOccupied) rowOccupied++;
      } else {
        // Explicitly distinguish any other/commercial/custom property types
        otherTotal++;
        if (isOccupied) otherOccupied++;
      }
    });

    const aptVacant = aptTotal - aptOccupied;
    const rowVacant = rowTotal - rowOccupied;
    const aptRate = aptTotal > 0 ? Math.round((aptOccupied / aptTotal) * 100) : 0;
    const rowRate = rowTotal > 0 ? Math.round((rowOccupied / rowTotal) * 100) : 0;

    const totalProperties = aptTotal + rowTotal + otherTotal;
    const totalOccupied = aptOccupied + rowOccupied + otherOccupied;
    const totalVacant = totalProperties - totalOccupied;
    const overallRate =
      totalProperties > 0 ? Math.round((totalOccupied / totalProperties) * 100) : 0;

    // Backward-compatible flat counters
    const totalFlats = totalProperties;
    const occupiedFlats = totalOccupied;
    const vacantFlats = totalVacant;

    // 5. Count open complaints
    const openComplaints = await Complaint.count({
      where: {
        society_id: societyId,
        status: { [Op.in]: ["OPEN", "PENDING", "IN_PROGRESS"] },
      },
    });

    // 6. Count parking utilization (only valid AVAILABLE and ASSIGNED records)
    let parkingTotal = 0;
    let parkingAllocated = 0;
    let parkingAvailable = 0;
    let parkingAllocationRate = 0;

    try {
      const [pTotal, pAllocated, pAvailable] = await Promise.all([
        ParkingSlot.count({
          where: {
            society_id: societyId,
            status: { [Op.in]: ["AVAILABLE", "ASSIGNED"] },
          },
        }),
        ParkingSlot.count({
          where: {
            society_id: societyId,
            status: "ASSIGNED",
          },
        }),
        ParkingSlot.count({
          where: {
            society_id: societyId,
            status: "AVAILABLE",
          },
        }),
      ]);

      parkingTotal = pTotal;
      parkingAllocated = pAllocated;
      parkingAvailable = pAvailable;
      parkingAllocationRate =
        parkingTotal > 0 ? Math.round((parkingAllocated / parkingTotal) * 100) : 0;
    } catch (err) {
      console.warn("[infoController] Parking count query fallback:", err.message);
    }

    res.json({
      // Preserved legacy fields
      residents,
      guards,
      openComplaints,
      totalFlats,
      occupiedFlats,
      vacantFlats,

      // Modern Property Occupancy Overview
      occupancy: {
        overallRate,
        totalProperties,
        totalOccupied,
        totalVacant,
        apartments: {
          total: aptTotal,
          occupied: aptOccupied,
          vacant: aptVacant,
          rate: aptRate,
        },
        rowHouses: {
          total: rowTotal,
          occupied: rowOccupied,
          vacant: rowVacant,
          rate: rowRate,
        },
      },

      // Modern Parking Utilization Overview
      parking: {
        total: parkingTotal,
        allocated: parkingAllocated,
        available: parkingAvailable,
        allocationRate: parkingAllocationRate,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
};

module.exports = { getAllStat };
