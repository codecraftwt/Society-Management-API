const Flat = require("../models/Flat");
const Floor = require("../models/Floor");
const ParkingSlot = require("../models/ParkingSlot");
const Block = require("../models/Block");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const HouseHoldMember = require("../models/HouseHoldMember");
const Payment = require("../models/Payment");
const Bill = require("../models/Bill");
const ResidentHistory = require("../models/ResidentHistory");
const FlatMembership = require("../models/FlatMembership");
const Vehicle = require("../models/Vehicle");
const { Op } = require("sequelize");
const { ensureAssignable } = require("../utils/approvalGuard");
const {
  sanitizeText,
  isEmpty,
  isPositiveNumber,
} = require("../utils/validation");

/* ─────────────────────────────────────────────────────────────
   SHARED LOCATION INCLUDES
───────────────────────────────────────────────────────────── */
const FLAT_LOCATION_INCLUDE = [
  {
    model: Floor,
    required: false,
    attributes: ["id", "floor_number"],
    include: [{ model: Block, required: false, attributes: ["id", "name"] }],
  },
  {
    model: Block,
    required: false,
    attributes: ["id", "name"],
  },
];

function resolveBlockName(flat) {
  return flat.Floor?.Block?.name || flat.Block?.name || null;
}

const createFlat = async (req, res) => {
  try {
    const { flat_number, block_id, floor_id, resident_id, flat_type, occupancy_status, area_sqft } = req.body;

    if (isEmpty(sanitizeText(flat_number))) {
      return res.status(400).json({ message: "Flat number is required." });
    }
    if (isEmpty(block_id)) {
      return res.status(400).json({ message: "Block is required." });
    }
    if (area_sqft != null && !isPositiveNumber(area_sqft)) {
      return res.status(400).json({ message: "area_sqft must be a positive number." });
    }

    const payload = {
      flat_number: sanitizeText(flat_number),
      block_id,
      floor_id: floor_id ?? null,
      resident_id: resident_id ?? null,
      flat_type: flat_type ?? null,
      occupancy_status: occupancy_status ?? "VACANT",
      area_sqft: area_sqft != null ? Number(area_sqft) : null,
    };
    const flat = await Flat.create(payload);
    res.status(200).json(flat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFlatsByFloor = async (req, res) => {
  try {
    const flats = await Flat.findAll({ where: { floor_id: req.params.floorId } });
    res.json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getUnassignedFlatsByFloor = async (req, res) => {
  try {
    const flats = await Flat.findAll({
      where: { floor_id: req.params.floorId, resident_id: null },
      attributes: ["id", "flat_number", "flat_type", "area_sqft"],
      include: [
        {
          model: Floor,
          required: false,
          attributes: ["id", "floor_number"],
          include: [{ model: Block, required: false, attributes: ["id", "name"] }],
        },
      ],
      order: [["flat_number", "ASC"]],
    });
    res.json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const assignFlatToResident = async (req, res) => {
  try {
    const { flatId } = req.params;
    const { resident_id, flat_type } = req.body;

    const flat = await Flat.findByPk(flatId, {
      include: [
        {
          model: Floor,
          attributes: ["id", "floor_number"],
          include: [{ model: Block, attributes: ["id", "name", "society_id"] }],
        },
        {
          model: Block,
          attributes: ["id", "name", "society_id"],
        },
      ],
    });
    if (!flat) return res.status(404).json({ message: "Flat not found" });
    if (flat.resident_id) return res.status(400).json({ message: "Flat is already occupied" });

    const resident = await User.findByPk(resident_id);
    if (!resident) return res.status(404).json({ message: "Resident not found" });

    const targetSocId = req.body.society_id || req.headers["x-society-id"];
    const effectiveSocietyId =
      flat.Block?.society_id ||
      flat.Floor?.Block?.society_id ||
      (targetSocId ? parseInt(targetSocId, 10) : null) ||
      req.user.society_id;

    await ResidentHistory.update(
      { move_out_date: new Date(), is_current: false },
      { where: { flat_id: flatId, is_current: true } }
    );
    await ResidentHistory.create({
      flat_id: flatId,
      user_id: resident_id,
      move_in_date: new Date(),
      is_current: true,
    });

    if (effectiveSocietyId) {
      // Preserve existing primary society in UserSociety if not already recorded
      if (resident.society_id) {
        const [origSociety] = await UserSociety.findOrCreate({
          where: { user_id: resident.id, society_id: resident.society_id },
          defaults: {
            membership_status: "ACTIVE",
            resident_type: resident.resident_type || "OWNER",
            occupant_count: resident.occupant_count || 1,
            vehicle_count: resident.vehicle_count || 0,
            emergency_contact: resident.emergency_contact || null,
            source: "MIGRATED",
            is_default: true,
          },
        });
        if (origSociety.membership_status !== "ACTIVE") {
          await origSociety.update({ membership_status: "ACTIVE" });
        }
        await UserSocietyRole.findOrCreate({
          where: { user_society_id: origSociety.id, role: "RESIDENT" },
          defaults: { user_society_id: origSociety.id, role: "RESIDENT" },
        });
      }

      // Add or activate target society membership
      const [userSociety] = await UserSociety.findOrCreate({
        where: { user_id: resident.id, society_id: effectiveSocietyId },
        defaults: {
          membership_status: "ACTIVE",
          resident_type: "OWNER",
          occupant_count: resident.occupant_count || 1,
          vehicle_count: 0,
          emergency_contact: resident.emergency_contact || null,
          source: "ADMIN_ASSIGNED",
          is_default: !resident.society_id,
        },
      });
      if (userSociety.membership_status !== "ACTIVE") {
        await userSociety.update({ membership_status: "ACTIVE" });
      }
      await UserSocietyRole.findOrCreate({
        where: { user_society_id: userSociety.id, role: "RESIDENT" },
        defaults: { user_society_id: userSociety.id, role: "RESIDENT" },
      });
    }

    const userUpdate = {};
    if (!resident.society_id && effectiveSocietyId) {
      userUpdate.society_id = effectiveSocietyId;
    }
    if (Object.keys(userUpdate).length > 0) {
      await resident.update(userUpdate);
    }

    await FlatMembership.update(
      { is_current: false, move_out_date: new Date() },
      { where: { flat_id: flatId, is_current: true } }
    );
    await FlatMembership.create({
      flat_id:          flatId,
      user_id:          resident_id,
      society_id:       effectiveSocietyId || null,
      role:             "OWNER",
      is_staying:       true,
      pays_maintenance: true,
      move_in_date:     new Date(),
      is_current:       true,
    });

    const flatUpdate = { resident_id };
    // Routine resident assignment must not overwrite an already-configured BHK
    if (!flat.flat_type && flat_type && ["1BHK", "2BHK", "3BHK"].includes(flat_type)) {
      flatUpdate.flat_type = flat_type;
    }
    await flat.update(flatUpdate);

    res.json({ message: "Flat assigned successfully", flat });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllFlats = async (req, res) => {
  try {
    const targetSocietyId = (req.user?.activeRole === "SUPER_ADMIN")
      ? (req.headers["x-society-id"] || req.query?.society_id)
      : req.user?.society_id;

    const blockWhere = targetSocietyId ? { society_id: targetSocietyId } : {};

    const blocks = await Block.findAll({
      where: blockWhere,
      attributes: ["id"],
    });
    const blockIds = blocks.map((b) => b.id);

    const flats = await Flat.findAll({
      where: { block_id: { [Op.in]: blockIds } },
      attributes: ["id", "flat_number", "flat_type", "resident_id", "floor_id", "block_id", "area_sqft"],
      include: [
        ...FLAT_LOCATION_INCLUDE,
        {
          model: User,
          required: false,
          attributes: ["id", "name", "email", "phone", "resident_type"],
        },
        {
          model: FlatMembership,
          required: false,
          include: [
            {
              model: User,
              required: false,
              attributes: ["id", "name", "email", "phone", "resident_type"],
            },
          ],
        },
      ],
      order: [["flat_number", "ASC"]],
    });

    console.log("Found flats count:", flats.length);
    if (flats.length > 0) {
      console.log("Sample flat keys:", Object.keys(flats[0].toJSON()));
      if (flats[0].Floor) console.log("Sample flat has Floor");
      if (flats[0].Block) console.log("Sample flat has Block");
    }

    res.status(200).json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getUnassignedFlats = async (req, res) => {
  try {
    const rawSocId = req.headers["x-society-id"] || req.query.society_id;
    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    const targetSocietyId = (isSuperAdmin && rawSocId)
      ? parseInt(rawSocId, 10)
      : (req.user.society_id || (rawSocId ? parseInt(rawSocId, 10) : null));

    const blockWhere = targetSocietyId ? { society_id: targetSocietyId } : {};
    const blocks = await Block.findAll({
      where: blockWhere,
      attributes: ["id"],
    });
    const blockIds = blocks.map((b) => b.id);

    const flats = await Flat.findAll({
      where: { resident_id: null, block_id: { [Op.in]: blockIds } },
      attributes: ["id", "flat_number", "flat_type", "floor_id", "block_id", "area_sqft"],
      include: FLAT_LOCATION_INCLUDE,
      order: [["flat_number", "ASC"]],
    });

    res.json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};





const assignResident = async (req, res) => {
  try {
    const { flatId } = req.params;

    const resident_id = req.body.resident_id || req.body.residentId;

    const {
      resident_type,
      flat_type,
      parking_slots = [], // [{ slot_id, parking_type }] — parking_type = "DEFAULT" | "EXTRA"
    } = req.body;

    if (!resident_id)
      return res.status(400).json({ message: "Resident ID is missing" });

    // A rejected registration must never be placed into a flat.
    const assignable = await ensureAssignable(resident_id);
    if (!assignable.ok) return res.status(assignable.status).json(assignable.payload);

    const flat = await Flat.findByPk(flatId, {
      include: [
        {
          model: Floor,
          attributes: ["id", "floor_number"],
          include: [{ model: Block, attributes: ["id", "name", "society_id"] }],
        },
        {
          model: Block,
          attributes: ["id", "name", "society_id"],
        },
      ],
    });
    if (!flat)
      return res.status(404).json({ message: "Flat not found" });

    if (flat.resident_id)
      return res.status(400).json({ message: "Flat already occupied" });

    const resident = await User.findByPk(resident_id);
    if (!resident)
      return res.status(404).json({ message: "Resident not found" });

    /* ─────────────────────────────
       1️⃣ Resident History
    ───────────────────────────── */
    await ResidentHistory.update(
      { move_out_date: new Date(), is_current: false },
      { where: { flat_id: flatId, is_current: true } }
    );

    await ResidentHistory.create({
      flat_id: flatId,
      user_id: resident_id,
      move_in_date: new Date(),
      is_current: true,
    });

    /* ─────────────────────────────
       2️⃣ Update Flat
    ───────────────────────────── */
    const isTenant = resident_type === "TENANT";

    const flatUpdate = {
      resident_id,
      // Routine resident assignment must not overwrite an already-configured BHK
      flat_type:        flat.flat_type || (["1BHK", "2BHK", "3BHK"].includes(flat_type) ? flat_type : null),
      occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
    };
    if (req.body.area_sqft != null) flatUpdate.area_sqft = Number(req.body.area_sqft);
    await flat.update(flatUpdate);

    const targetSocId = req.body.society_id || req.headers["x-society-id"];
    const effectiveSocietyId =
      flat.Block?.society_id ||
      flat.Floor?.Block?.society_id ||
      (targetSocId ? parseInt(targetSocId, 10) : null) ||
      req.user.society_id;

    /* ─────────────────────────────
       3️⃣ Normalized Multi-Society Membership & Roles
       - Preserve resident's initial society in UserSociety (do not overwrite!)
       - Create or activate UserSociety & UserSocietyRole in the assigned society
    ───────────────────────────── */
    if (effectiveSocietyId) {
      // Step A: Safety net for resident's original primary society
      if (resident.society_id) {
        const [origSociety] = await UserSociety.findOrCreate({
          where: {
            user_id: resident.id,
            society_id: resident.society_id,
          },
          defaults: {
            membership_status: "ACTIVE",
            resident_type: resident.resident_type || "OWNER",
            occupant_count: resident.occupant_count || 1,
            vehicle_count: resident.vehicle_count || 0,
            emergency_contact: resident.emergency_contact || null,
            source: "MIGRATED",
            is_default: true,
          },
        });
        if (origSociety.membership_status !== "ACTIVE") {
          await origSociety.update({ membership_status: "ACTIVE" });
        }
        await UserSocietyRole.findOrCreate({
          where: {
            user_society_id: origSociety.id,
            role: "RESIDENT",
          },
          defaults: {
            user_society_id: origSociety.id,
            role: "RESIDENT",
          },
        });
      }

      // Step B: Create / activate membership in the target society
      const [userSociety] = await UserSociety.findOrCreate({
        where: {
          user_id: resident.id,
          society_id: effectiveSocietyId,
        },
        defaults: {
          membership_status: "ACTIVE",
          resident_type: resident_type || "OWNER",
          occupant_count: resident.occupant_count || 1,
          vehicle_count: 0,
          emergency_contact: resident.emergency_contact || null,
          source: "ADMIN_ASSIGNED",
          is_default: !resident.society_id,
        },
      });

      if (userSociety.membership_status !== "ACTIVE") {
        await userSociety.update({ membership_status: "ACTIVE" });
      }

      await UserSocietyRole.findOrCreate({
        where: {
          user_society_id: userSociety.id,
          role: "RESIDENT",
        },
        defaults: {
          user_society_id: userSociety.id,
          role: "RESIDENT",
        },
      });
    }

    // Step C: Update User fields without overriding existing society_id
    const userUpdate = {};
    if (resident_type && (!resident.resident_type || resident.society_id === effectiveSocietyId)) {
      userUpdate.resident_type = resident_type;
    }
    // Only set user.society_id if user has NO society_id at all (never overwrite existing)
    if (!resident.society_id && effectiveSocietyId) {
      userUpdate.society_id = effectiveSocietyId;
    }

    let roles = [];
    if (Array.isArray(resident.roles)) {
      roles = [...resident.roles];
    } else if (typeof resident.roles === "string") {
      try { roles = JSON.parse(resident.roles) || []; } catch (e) { roles = []; }
    }
    if (resident.role && !roles.includes(resident.role)) {
      roles.push(resident.role);
    }
    if (!roles.includes("RESIDENT")) {
      roles.push("RESIDENT");
      userUpdate.roles = roles;
    }
    if (!resident.role) {
      userUpdate.role = "RESIDENT";
    }
    if (resident.approval_status !== "APPROVED") {
      userUpdate.approval_status = "APPROVED";
    }
    if (resident.status !== "ACTIVE") {
      userUpdate.status = "ACTIVE";
    }
    if (Object.keys(userUpdate).length > 0) {
      await resident.update(userUpdate);
    }

    /* ─────────────────────────────
       4️⃣ FlatMembership
    ───────────────────────────── */
    await FlatMembership.update(
      { is_current: false, move_out_date: new Date() },
      { where: { flat_id: flatId, is_current: true } }
    );

    await FlatMembership.create({
      flat_id:          flatId,
      user_id:          resident_id,
      society_id:       effectiveSocietyId || null,
      role:             resident_type || "OWNER",
      is_staying:       true,
      pays_maintenance: true,
      move_in_date:     new Date(),
      is_current:       true,
    });

    /* ─────────────────────────────
       4️⃣ PARKING SLOTS
       - Release any existing slots for this flat first
       - Then assign new ones with parking_type stamped
         directly on the ParkingSlot row (DEFAULT / EXTRA)
       - First slot in the array = DEFAULT, rest = EXTRA
         (frontend already sends parking_type per slot,
          but we also enforce index-based rule as safety net)
    ───────────────────────────── */

    // Release all previously assigned slots for this flat
    await ParkingSlot.update(
      { flat_id: null, resident_id: null, status: "AVAILABLE", parking_type: "DEFAULT" },
      { where: { flat_id: flatId } }
    );

    // Assign new slots if provided
    if (parking_slots.length > 0) {
      for (const [idx, slotData] of parking_slots.entries()) {
        const slotWhere = {
          id:     slotData.slot_id,
          status: "AVAILABLE",
        };
        if (effectiveSocietyId) {
          slotWhere.society_id = effectiveSocietyId;
        }
        const slot = await ParkingSlot.findOne({
          where: slotWhere,
        });

        if (!slot) {
          return res.status(400).json({
            message: `Slot ${slotData.slot_id} is not available or does not belong to this society`,
          });
        }

        // ✅ parking_type lives on ParkingSlot — NOT on Vehicle
        // Use what the frontend sent, but enforce index rule as safety net:
        // index 0 = DEFAULT (permanent flat entitlement)
        // index 1+ = EXTRA  (additional removable slot)
        slot.flat_id      = flatId;
        slot.resident_id  = resident_id;
        slot.status       = "ASSIGNED";
        slot.parking_type = idx === 0 ? "DEFAULT" : "EXTRA"; // ✅ enforce on ParkingSlot

        await slot.save();
      }
    }

    res.json({ message: "Resident assigned successfully" });

  } catch (err) {
    console.error("❌ [assignResident] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

const deleteFlat = async (req, res) => {
  try {
    const { flatId } = req.params;

    const flat = await Flat.findByPk(flatId);
    if (!flat) return res.status(404).json({ message: "Flat not found" });
    const activeMembers = await FlatMembership.count({ where: { flat_id: flatId, is_current: true } });
    if (flat.resident_id || activeMembers > 0)
      return res.status(400).json({
        message: "Cannot delete occupied flat. Unassign resident first.",
      });

    const bills = await Bill.findAll({ where: { flat_id: flatId }, attributes: ["id"] });
    if (bills.length > 0) {
      const unpaidCount = await Payment.count({
        where: { bill_id: { [Op.in]: bills.map((b) => b.id) } },
      });
      if (unpaidCount > 0)
        return res.status(400).json({
          message: "Cannot delete flat with pending payments. Clear dues first.",
        });
    }

    await FlatMembership.destroy({ where: { flat_id: flatId } });
    await ParkingSlot.update(
      { flat_id: null, resident_id: null, status: "AVAILABLE" },
      { where: { flat_id: flatId } }
    );
    await Vehicle.destroy({ where: { flat_id: flatId } });
    await HouseHoldMember.destroy({ where: { flat_id: flatId } });

    await flat.destroy();
    res.json({ message: "Flat deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   GET ASSIGNED FLATS
   Returns flats that currently have an active resident/member
   so shared UI dropdowns can use the same society-scoped list.
───────────────────────────────────────────────────────────── */
const getAssignedFlats = async (req, res) => {
  try {
    const page       = parseInt(req.query.page)  || 1;
    const limit      = parseInt(req.query.limit) || 10;
    const offset     = (page - 1) * limit;
    const search     = req.query.search      || "";
    const filterType = req.query.filter_type || "";

    const blocks = await Block.findAll({
      where: { society_id: req.user.society_id },
      attributes: ["id"],
    });
    const blockIds = blocks.map((b) => b.id);

    const flatWhere = {
      resident_id:      { [Op.ne]: null },
      block_id:         { [Op.in]: blockIds },
      ...(search && { flat_number: { [Op.like]: `%${search}%` } }),
    };

    const userWhere = { status: "ACTIVE" };
    if (filterType === "OWNER" || filterType === "TENANT") {
      userWhere.resident_type = filterType;
    }

    const { count, rows } = await Flat.findAndCountAll({
      where: flatWhere,
      attributes: ["id", "flat_number", "flat_type", "floor_id", "block_id", "area_sqft"],
      include: [
        {
          model:      User,
          attributes: ["id", "name", "phone", "resident_type"],
          where:      userWhere,
          required:   true,
        },
        {
          model:    Floor,
          required: false,
          attributes: ["id", "floor_number"],
          include: [{ model: Block, required: false, attributes: ["id", "name"] }],
        },
        {
          model:    Block,
          required: false,
          attributes: ["id", "name"],
        },
      ],
      limit,
      offset,
      order: [["flat_number", "ASC"]],
    });

    res.json({
      data: rows,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
      },
      totalAll: count,
    });
  } catch (err) {
    console.error("Error in getAssignedFlats:", err);
    res.status(500).json({ message: err.message });
  }
};

const unassignResident = async (req, res) => {
  try {
    const { flatId } = req.params;

    const flat = await Flat.findByPk(flatId);
    if (!flat) return res.status(404).json({ message: "Flat not found" });

    await ResidentHistory.update(
      { move_out_date: new Date(), is_current: false },
      { where: { flat_id: flatId, is_current: true } }
    );

    await HouseHoldMember.destroy({ where: { flat_id: flat.id } });

    await FlatMembership.update(
      { is_current: false, move_out_date: new Date() },
      { where: { flat_id: flatId, is_current: true } }
    );

    await flat.update({ resident_id: null });

    // ✅ Release parking slots and reset parking_type back to DEFAULT
    await ParkingSlot.update(
      { flat_id: null, resident_id: null, status: "AVAILABLE", parking_type: "DEFAULT" },
      { where: { flat_id: flatId } }
    );

    res.json({ message: "Resident unassigned + history updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getNeighbours = async (req, res) => {
  try {
    const blocks = await Block.findAll({
      where: { society_id: req.user.society_id },
      attributes: ["id"],
    });
    const blockIds = blocks.map((b) => b.id);

    const myFlat = await Flat.findOne({ where: { resident_id: req.user.id } });

    const where = { resident_id: { [Op.ne]: null }, block_id: { [Op.in]: blockIds } };
    if (myFlat) where.id = { [Op.ne]: myFlat.id };

    const neighbours = await Flat.findAll({
      where,
      attributes: ["id", "flat_number", "flat_type"],
      include: [
        { model: User, attributes: ["id", "name", "phone", "email"], required: true },
        ...FLAT_LOCATION_INCLUDE,
      ],
      order: [["flat_number", "ASC"]],
    });

    res.status(200).json(neighbours);
  } catch (err) {
    console.error("Error in getNeighbours:", err);
    res.status(500).json({ message: err.message });
  }
};

// const getFlatsByBlockAndFloor = async (req, res) => {
//   try {
//     const blockId = req.params.blockId || req.query.blockId;
//     const { floorId } = req.query;

//     if (!blockId) {
//       return res.status(400).json({ message: "blockId is required" });
//     }

//     const where = { block_id: Number(blockId) };

//     if (floorId) {
//       where.floor_id = Number(floorId);
//     }

//     const flats = await Flat.findAll({
//       where,
//       attributes: ["id", "flat_number", "flat_type", "resident_id", "floor_id", "block_id", "area_sqft"],
//       order: [["flat_number", "ASC"]],
//     });

//     res.json(flats);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.message });
//   }
// };

const getFlatsByBlockAndFloor = async (req, res) => {
  try {
    const rawBlockId = req.params.blockId || req.query.blockId;
    const rawFloorId = req.query.floorId || req.query.floor_id;

    const blockId = parseInt(rawBlockId, 10);
    const floorId = rawFloorId ? parseInt(rawFloorId, 10) : null;

    // ✅ Hard stop — never hit the DB with NaN
    if (!rawBlockId || isNaN(blockId) || blockId <= 0) {
      return res.status(400).json({ message: "blockId is required and must be a valid number" });
    }
    if (rawFloorId && (isNaN(floorId) || floorId <= 0)) {
      return res.status(400).json({ message: "floorId must be a valid number" });
    }

    const where = { block_id: blockId };
    if (floorId) {
      where.floor_id = floorId;
    }

    const flats = await Flat.findAll({
      where,
      attributes: ["id", "flat_number", "flat_type", "resident_id", "floor_id", "block_id", "area_sqft"],
      order: [["flat_number", "ASC"]],
    });

    res.json(flats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   UPDATE FLAT
   PUT /flats/update/:flatId
   Whitelisted fields only — safe for area_sqft updates.
───────────────────────────────────────────────────────────── */
const updateFlat = async (req, res) => {
  try {
    const { flatId } = req.params;
    const flat = await Flat.findByPk(flatId);
    if (!flat) return res.status(404).json({ message: "Flat not found" });

    const allowed = ["area_sqft", "flat_number", "flat_type", "occupancy_status"];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === "flat_type") {
          if (req.body.flat_type !== null && !["1BHK", "2BHK", "3BHK"].includes(req.body.flat_type)) {
            return res.status(400).json({ message: "Invalid flat_type. Allowed: 1BHK, 2BHK, 3BHK." });
          }
          updates.flat_type = req.body.flat_type;
        } else if (field === "area_sqft") {
          updates.area_sqft = req.body.area_sqft != null ? Number(req.body.area_sqft) : null;
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    await flat.update(updates);
    res.json({ message: "Flat updated", flat });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   BULK UPDATE FLATS (area / BHK assignment)
   PUT /flats/bulk-update
   Body: { flats: [{ flat_id, area_sqft, flat_type }] }
───────────────────────────────────────────────────────────── */
const bulkUpdateFlats = async (req, res) => {
  try {
    const { flats } = req.body;
    if (!Array.isArray(flats) || flats.length === 0) {
      return res.status(400).json({ message: "flats array is required" });
    }

    const results = [];
    for (const item of flats) {
      if (!item.flat_id) continue;
      const flat = await Flat.findByPk(item.flat_id);
      if (!flat) continue;
      const updates = {};
      if (item.area_sqft !== undefined) updates.area_sqft = item.area_sqft != null ? Number(item.area_sqft) : null;
      if (item.flat_type !== undefined) {
        if (item.flat_type === null || ["1BHK", "2BHK", "3BHK"].includes(item.flat_type)) {
          updates.flat_type = item.flat_type;
        }
      }
      if (Object.keys(updates).length > 0) {
        await flat.update(updates);
        results.push({ flat_id: flat.id, area_sqft: flat.area_sqft, flat_type: flat.flat_type });
      }
    }

    res.json({ message: `Updated ${results.length} flat(s)`, updated: results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createFlat,
  getFlatsByFloor,
  getUnassignedFlatsByFloor,
  assignFlatToResident,
  assignResident,
  getAllFlats,
  getAssignedFlats,
  unassignResident,
  getUnassignedFlats,
  deleteFlat,
  getNeighbours,
  getNeighbours,
  getFlatsByBlockAndFloor,
  getFlatsByBlock: getFlatsByBlockAndFloor, // Alias for convenience
  updateFlat,
  bulkUpdateFlats,
};
