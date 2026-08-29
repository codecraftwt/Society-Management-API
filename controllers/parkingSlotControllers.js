
const { ParkingSlot, Flat, Block, Floor, HouseHoldMember, User } = require("../models");
const FlatMembership = require("../models/FlatMembership");
const Vehicle        = require("../models/Vehicle");
const { Op }         = require("sequelize");


/* ── helper ── */
const getPrimaryResidentId = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.resident_id;
  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) {
    const f = await Flat.findByPk(member.flat_id);
    if (f) return f.resident_id;
  }
  return userId;
};


/* ═══════════════════════════════════════════
   1️⃣  CREATE PARKING SLOTS  (SOCIETY_ADMIN)
═══════════════════════════════════════════ */
const createParkingSlots = async (req, res) => {
  try {
    const { prefix, start_number, count, vehicle_type, parking_floor } = req.body;

    if (!prefix || !start_number || !count || !vehicle_type) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const slotsToCreate = [];

    for (let i = 0; i < count; i++) {
      const slotNumber = `${prefix}-${Number(start_number) + i}`;

      const existing = await ParkingSlot.findOne({
        where: {
          society_id:  req.user.society_id,
          slot_number: slotNumber,
        },
      });

      if (!existing) {
        slotsToCreate.push({
          society_id:    req.user.society_id,
          slot_number:   slotNumber,
          vehicle_type,
          parking_floor: parking_floor || null,
          status:        "AVAILABLE",
        });
      }
    }

    if (slotsToCreate.length === 0) {
      return res.status(400).json({ message: "All slots already exist" });
    }

    await ParkingSlot.bulkCreate(slotsToCreate);

    res.status(201).json({
      message: `${slotsToCreate.length} parking slots created successfully`,
    });
  } catch (err) {
    console.error("CREATE SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};


/* ═══════════════════════════════════════════
   2️⃣  GET PARKING SLOTS — PAGINATED  (GUARD + ADMIN)
═══════════════════════════════════════════ */
const getParkingSlots = async (req, res) => {
  try {
    const page         = Math.max(1,   parseInt(req.query.page)   || 1);
    const limit        = Math.min(100, parseInt(req.query.limit)  || 20);
    const offset       = (page - 1) * limit;
    const search       = req.query.search?.trim() || "";
    const vehicleType  = req.query.vehicle_type  || "ALL";
    const statusFilter = req.query.status        || "ALL";
    const parkingType  = req.query.parking_type || "ALL";

    const baseWhere = { society_id: req.user.society_id };
    const where     = { ...baseWhere };

    if (vehicleType !== "ALL") where.vehicle_type = vehicleType;
    if (statusFilter !== "ALL") where.status = statusFilter;
    if (parkingType !== "ALL") where.parking_type = parkingType;
    if (search) {
      where[Op.or] = [
        { slot_number:       { [Op.like]: `%${search}%` } },
        { "$Flat.flat_number$":       { [Op.like]: `%${search}%` } },
        { "$resident.name$":          { [Op.like]: `%${search}%` } },
        { "$Vehicle.vehicle_number$": { [Op.like]: `%${search}%` } },
      ];
    }

    const include = [
      { model: Flat,    as: "Flat",     attributes: ["id", "flat_number"], required: false },
      { model: User,    as: "resident", attributes: ["id", "name", "email", "phone"], required: false },
      { model: Vehicle, as: "Vehicle",  attributes: ["id", "vehicle_number", "vehicle_name", "vehicle_type"], required: false },
    ];

    const { count, rows: slots } = await ParkingSlot.findAndCountAll({
      where,
      include,
      order:  [["slot_number", "ASC"]],
      limit,
      offset,
    });

    const mapSlot = (s) => {
      const j = s.toJSON();
      return {
        id:             j.id,
        society_id:     j.society_id,
        slot_number:    j.slot_number,
        parking_floor:  j.parking_floor,
        vehicle_type:   j.vehicle_type,
        status:         j.status,
        parking_type:   j.parking_type,
        flat_id:        j.flat_id,
        resident_id:    j.resident_id,
        flat_number:    j.Flat?.flat_number || null,
        resident:       j.resident ? { id: j.resident.id, name: j.resident.name, email: j.resident.email, phone: j.resident.phone } : null,
        vehicle:        j.Vehicle
          ? { id: j.Vehicle.id, vehicle_number: j.Vehicle.vehicle_number, vehicle_name: j.Vehicle.vehicle_name, vehicle_type: j.Vehicle.vehicle_type }
          : null,
      };
    };

    const [
      totalAll,
      totalCars,
      totalBikes,
      totalAvailable,
      totalOccupied,
    ] = await Promise.all([
      ParkingSlot.count({ where: baseWhere }),
      ParkingSlot.count({ where: { ...baseWhere, vehicle_type: "CAR"  } }),
      ParkingSlot.count({ where: { ...baseWhere, vehicle_type: "BIKE" } }),
      ParkingSlot.count({ where: { ...baseWhere, status: "AVAILABLE"  } }),
      ParkingSlot.count({ where: { ...baseWhere, status: { [Op.ne]: "AVAILABLE" } } }),
    ]);

    res.json({
      data: slots.map(mapSlot),
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      stats: {
        total:     totalAll,
        cars:      totalCars,
        bikes:     totalBikes,
        available: totalAvailable,
        occupied:  totalOccupied,
      },
    });
  } catch (err) {
    console.error("GET SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};


/* ═══════════════════════════════════════════
   3️⃣  GET AVAILABLE SLOTS BY VEHICLE TYPE  (GUARD + ADMIN picker)
   → Only returns status=AVAILABLE slots
   → Route: GET /parking-slots/available?vehicle_type=CAR
═══════════════════════════════════════════ */
const getAvailableSlots = async (req, res) => {
  try {
    const { vehicle_type } = req.query;

    const where = {
      society_id: req.user.society_id,
      status:     "AVAILABLE",
    };

    if (vehicle_type && vehicle_type !== "ALL") {
      where.vehicle_type = vehicle_type;
    }

    const slots = await ParkingSlot.findAll({
      where,
      order: [["slot_number", "ASC"]],
    });

    res.json(slots);
  } catch (err) {
    console.error("GET AVAILABLE SLOTS ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};


/* ═══════════════════════════════════════════
   4️⃣  DELETE SLOT  (ADMIN only)
═══════════════════════════════════════════ */
const deleteParkingSlot = async (req, res) => {
  try {
    const slot = await ParkingSlot.findByPk(req.params.id);
    if (!slot) return res.status(404).json({ message: "Slot not found" });

    await slot.destroy();
    res.json({ message: "Parking slot deleted" });
  } catch (err) {
    console.error("DELETE SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};


/* ═══════════════════════════════════════════
   5️⃣  REVOKE SLOT ASSIGNMENT  (ADMIN only)
   → Resets slot to AVAILABLE and clears flat/resident
═══════════════════════════════════════════ */
const revokeSlotAssignment = async (req, res) => {
  try {
    const { slot_id } = req.body;

    const slot = await ParkingSlot.findOne({
      where: { id: slot_id, society_id: req.user.society_id },
    });

    if (!slot) return res.status(404).json({ message: "Slot not found" });

    slot.status      = "AVAILABLE";
    slot.flat_id     = null;
    slot.resident_id = null;
    await slot.save();

    // Also unlink any vehicles pointing to this slot
    await Vehicle.update(
      { parking_slot_id: null },
      { where: { parking_slot_id: slot_id, society_id: req.user.society_id } }
    );

    res.json({ message: "Slot assignment revoked", slot });
  } catch (err) {
    console.error("REVOKE FLAT SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};


/* ═══════════════════════════════════════════
   6️⃣  GET MY ALLOCATED SLOTS  (RESIDENT / OWNER)
   → Single query with JOINs — no N+1 loops
   → parking_type (DEFAULT/EXTRA) from ParkingSlot row
   → Linked vehicle joined directly (LEFT JOIN vehicles)
   → Flat + Floor + Block joined in one shot
   → Route: GET /parking-slots/my-slots
═══════════════════════════════════════════ */
// const getMyAllocatedSlots = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const societyId = req.user.society_id;

//     const primaryResidentId = await getPrimaryResidentId(userId);

//     /* 1️⃣ Collect flat IDs */
//     const [memberships, directFlat] = await Promise.all([
//       FlatMembership.findAll({
//         where: { user_id: primaryResidentId, is_current: true },
//         attributes: ["flat_id"],
//       }),

//       Flat.findOne({
//         where: { resident_id: primaryResidentId },
//         attributes: ["id"],
//       }),
//     ]);

//     const flatIdSet = new Set(memberships.map((m) => m.flat_id));

//     if (directFlat) {
//       flatIdSet.add(directFlat.id);
//     }

//     const flatIds = [...flatIdSet];

//     if (flatIds.length === 0) {
//       return res.json({
//         slots: [],
//         flats: [],
//       });
//     }

//     /* 2️⃣ Fetch all allocated slots */
//     const slots = await ParkingSlot.findAll({
//       where: {
//         flat_id: { [Op.in]: flatIds },
//         society_id: societyId,
//       },

//       attributes: [
//         "id",
//         "slot_number",
//         "vehicle_type",
//         "parking_floor",
//         "parking_type",
//         "status",
//         "flat_id",
//       ],

//       include: [
//         {
//           model: Vehicle,
//           as: "Vehicle",
//           required: false,

//           attributes: [
//             "id",
//             "vehicle_number",
//             "vehicle_name",
//             "vehicle_type",
//           ],

//           where: {
//             society_id: societyId,
//           },
//         },

//         {
//           model: Flat,
//           as: "Flat",
//           required: false,

//           attributes: [
//             "id",
//             "flat_number",
//             "floor_id",
//             "flat_type",
//           ],

//           include: [
//             {
//               model: Floor,
//               required: false,

//               attributes: [
//                 "id",
//                 "floor_number",
//               ],

//               include: [
//                 {
//                   model: Block,
//                   required: false,
//                   attributes: ["id", "name"],
//                 },
//               ],
//             },

//             {
//               model: Block,
//               required: false,
//               attributes: ["id", "name"],
//             },
//           ],
//         },
//       ],

//       order: [
//         [
//           require("sequelize").literal(`
//             CASE
//               WHEN ParkingSlot.parking_type = 'DEFAULT' THEN 0
//               ELSE 1
//             END
//           `),
//           "ASC",
//         ],

//         ["slot_number", "ASC"],
//       ],
//     });

//     /* 3️⃣ Shape response */
//     const enrichedSlots = slots.map((slot) => {
//       const s = slot.toJSON();

//       const vehicle = s.Vehicle || null;
//       const flat = s.Flat || null;

//       return {
//         id: s.id,

//         slot_number: s.slot_number,

//         parking_floor: s.parking_floor,

//         vehicle_type: s.vehicle_type,

//         parking_type: s.parking_type, // DEFAULT / EXTRA

//         status: s.status,

//         flat_id: s.flat_id,

//         is_occupied: !!vehicle,

//         flat: flat
//           ? {
//               id: flat.id,
//               flat_number: flat.flat_number,
//               floor_id: flat.floor_id,
//               flat_type: flat.flat_type,

//               block_name:
//                 flat.Floor?.Block?.name ||
//                 flat.Block?.name ||
//                 null,

//               floor_number:
//                 flat.Floor?.floor_number ?? null,
//             }
//           : null,

//         linked_vehicle: vehicle
//           ? {
//               id: vehicle.id,
//               vehicle_number: vehicle.vehicle_number,
//               vehicle_name: vehicle.vehicle_name,
//               vehicle_type: vehicle.vehicle_type,
//             }
//           : null,
//       };
//     });

//     /* 4️⃣ Flat list */
//     const flats = await Flat.findAll({
//       where: {
//         id: { [Op.in]: flatIds },
//       },

//       attributes: [
//         "id",
//         "flat_number",
//         "floor_id",
//         "block_id",
//         "flat_type",
//       ],

//       include: [
//         {
//           model: Floor,
//           required: false,

//           attributes: [
//             "id",
//             "floor_number",
//           ],

//           include: [
//             {
//               model: Block,
//               required: false,
//               attributes: ["id", "name"],
//             },
//           ],
//         },

//         {
//           model: Block,
//           required: false,
//           attributes: ["id", "name"],
//         },
//       ],
//     });

//     const flatList = flats.map((f) => ({
//       id: f.id,

//       flat_number: f.flat_number,

//       floor_id: f.floor_id,

//       flat_type: f.flat_type,

//       block_name:
//         f.Floor?.Block?.name ||
//         f.Block?.name ||
//         null,

//       floor_number:
//         f.Floor?.floor_number ?? null,
//     }));

//     return res.json({
//       slots: enrichedSlots,
//       flats: flatList,
//     });

//   } catch (err) {
//     console.error("GET MY SLOTS ERROR:", err);

//     return res.status(500).json({
//       message: "Server Error",
//     });
//   }
// };

const getMyAllocatedSlots = async (req, res) => {
  try {
    const userId    = req.user.id;
    const societyId = req.user.society_id;

    const primaryResidentId = await getPrimaryResidentId(userId);

    /* 1️⃣ Collect flat IDs */
    const [memberships, directFlat] = await Promise.all([
      FlatMembership.findAll({
        where:      { user_id: primaryResidentId, is_current: true },
        attributes: ["flat_id"],
      }),
      Flat.findOne({
        where:      { resident_id: primaryResidentId },
        attributes: ["id"],
      }),
    ]);

    const flatIdSet = new Set(memberships.map((m) => m.flat_id));
    if (directFlat) flatIdSet.add(directFlat.id);
    const flatIds = [...flatIdSet];

    if (flatIds.length === 0) return res.json({ slots: [], flats: [] });

    /* 2️⃣ Fetch allocated slots
          — DEFAULT slots: always show (flat_id is permanent)
          — EXTRA slots:   only show when ASSIGNED (flat_id set + vehicle linked)
                           when freed, flat_id=null so they won't appear here    */
    const slots = await ParkingSlot.findAll({
      where: {
        flat_id:    { [Op.in]: flatIds },
        society_id: societyId,
      },
      attributes: [
        "id", "slot_number", "vehicle_type",
        "parking_floor", "parking_type", "status", "flat_id",
      ],
      include: [
        {
          model:      Vehicle,
          as:         "Vehicle",
          required:   false,
          attributes: ["id", "vehicle_number", "vehicle_name", "vehicle_type"],
          where:      { society_id: societyId },
        },
        {
          model:      Flat,
          as:         "Flat",
          required:   false,
          attributes: ["id", "flat_number", "floor_id", "flat_type"],
          include: [
            {
              model:      Floor,
              required:   false,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, required: false, attributes: ["id", "name"] }],
            },
            { model: Block, required: false, attributes: ["id", "name"] },
          ],
        },
      ],
      order: [
        [require("sequelize").literal(
          `CASE WHEN ParkingSlot.parking_type = 'DEFAULT' THEN 0 ELSE 1 END`
        ), "ASC"],
        ["slot_number", "ASC"],
      ],
    });

    /* 3️⃣ Shape response — trust parking_type from DB directly,
          no workaround needed once adminAssignResidentSlot sets
          parking_type = "EXTRA" correctly on the slot row        */
    const enrichedSlots = slots.map((slot) => {
      const s       = slot.toJSON();
      const vehicle = s.Vehicle || null;
      const flat    = s.Flat    || null;

      return {
        id:             s.id,
        slot_number:    s.slot_number,
        parking_floor:  s.parking_floor,
        vehicle_type:   s.vehicle_type,
        parking_type:   s.parking_type,  // ← trust DB directly
        status:         s.status,
        flat_id:        s.flat_id,
        is_occupied:    !!vehicle,
        flat: flat ? {
          id:           flat.id,
          flat_number:  flat.flat_number,
          floor_id:     flat.floor_id,
          flat_type:    flat.flat_type,
          block_name:   flat.Floor?.Block?.name || flat.Block?.name || null,
          floor_number: flat.Floor?.floor_number ?? null,
        } : null,
        linked_vehicle: vehicle ? {
          id:             vehicle.id,
          vehicle_number: vehicle.vehicle_number,
          vehicle_name:   vehicle.vehicle_name,
          vehicle_type:   vehicle.vehicle_type,
        } : null,
      };
    });

    /* 4️⃣ Flat list */
    const flats = await Flat.findAll({
      where:      { id: { [Op.in]: flatIds } },
      attributes: ["id", "flat_number", "floor_id", "block_id", "flat_type"],
      include: [
        {
          model:      Floor,
          required:   false,
          attributes: ["id", "floor_number"],
          include: [{ model: Block, required: false, attributes: ["id", "name"] }],
        },
        { model: Block, required: false, attributes: ["id", "name"] },
      ],
    });

    const flatList = flats.map((f) => ({
      id:           f.id,
      flat_number:  f.flat_number,
      floor_id:     f.floor_id,
      flat_type:    f.flat_type,
      block_name:   f.Floor?.Block?.name || f.Block?.name || null,
      floor_number: f.Floor?.floor_number ?? null,
    }));

    return res.json({ slots: enrichedSlots, flats: flatList });

  } catch (err) {
    console.error("GET MY SLOTS ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  createParkingSlots,
  getParkingSlots,
  getAvailableSlots,
  deleteParkingSlot,
  revokeSlotAssignment,
  getMyAllocatedSlots,
};