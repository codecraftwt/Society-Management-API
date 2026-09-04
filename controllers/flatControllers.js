const Flat = require("../models/Flat");
const Floor = require("../models/Floor");
const ParkingSlot = require("../models/ParkingSlot");
const Block = require("../models/Block");
const User = require("../models/User");
const HouseHoldMember = require("../models/HouseHoldMember");
const Payment = require("../models/Payment");
const Bill = require("../models/Bill");
const ResidentHistory = require("../models/ResidentHistory");
const FlatMembership = require("../models/FlatMembership");
const Vehicle = require("../models/Vehicle");
const { Op } = require("sequelize");

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
    const payload = {
      flat_number,
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

    const flat = await Flat.findByPk(flatId);
    if (!flat) return res.status(404).json({ message: "Flat not found" });
    if (flat.resident_id) return res.status(400).json({ message: "Flat is already occupied" });

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

    await FlatMembership.update(
      { is_current: false, move_out_date: new Date() },
      { where: { flat_id: flatId, is_current: true } }
    );
    await FlatMembership.create({
      flat_id:          flatId,
      user_id:          resident_id,
      role:             "OWNER",
      is_staying:       true,
      pays_maintenance: true,
      move_in_date:     new Date(),
      is_current:       true,
    });

    const flatUpdate = { resident_id };
    if (flat_type) flatUpdate.flat_type = flat_type;
    await flat.update(flatUpdate);

    res.json({ message: "Flat assigned successfully", flat });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllFlats = async (req, res) => {
  try {
    const targetSocietyId = (req.user?.activeRole === "SUPER_ADMIN" && req.headers["x-society-id"])
      ? req.headers["x-society-id"]
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
      include: FLAT_LOCATION_INCLUDE,
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
    const blocks = await Block.findAll({
      where: { society_id: req.user.society_id },
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

    const flat = await Flat.findByPk(flatId);
    if (!flat)
      return res.status(404).json({ message: "Flat not found" });

    if (flat.resident_id)
      return res.status(400).json({ message: "Flat already occupied" });

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
      flat_type:        flat_type || flat.flat_type,
      occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
    };
    if (req.body.area_sqft != null) flatUpdate.area_sqft = Number(req.body.area_sqft);
    await flat.update(flatUpdate);

    if (resident_type) {
      await User.update(
        { resident_type },
        { where: { id: resident_id } }
      );
    }

    /* ─────────────────────────────
       3️⃣ FlatMembership
    ───────────────────────────── */
    await FlatMembership.update(
      { is_current: false, move_out_date: new Date() },
      { where: { flat_id: flatId, is_current: true } }
    );

    await FlatMembership.create({
      flat_id:          flatId,
      user_id:          resident_id,
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
        const slot = await ParkingSlot.findOne({
          where: {
            id:         slotData.slot_id,
            society_id: req.user.society_id, // ✅ security: must belong to this society
            status:     "AVAILABLE",
          },
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
        updates[field] = field === "area_sqft" ? (req.body[field] != null ? Number(req.body[field]) : null) : req.body[field];
      }
    }

    await flat.update(updates);
    res.json({ message: "Flat updated", flat });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   BULK UPDATE FLATS (area assignment for row houses)
   PUT /flats/bulk-update
   Body: { flats: [{ flat_id, area_sqft }] }
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
      if (Object.keys(updates).length > 0) {
        await flat.update(updates);
        results.push({ flat_id: flat.id, area_sqft: flat.area_sqft });
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
