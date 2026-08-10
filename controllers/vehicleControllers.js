const Vehicle = require("../models/Vehicle");
const { ParkingSlot, Flat, HouseHoldMember, User } = require("../models");
const { Op } = require("sequelize");
const { literal } = require("sequelize");

/* ── helpers ── */
const getFlatIdForUser = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.id;
  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  return member ? member.flat_id : null;
};

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

/* ══════════════════════════════════════════════════
   POST /vehicles  —  resident adds a vehicle
══════════════════════════════════════════════════ */
// const addVehicle = async (req, res) => {
//   try {
//     const {
//       vehicle_name,
//       vehicle_number,
//       vehicle_type,
//       flat_id,
//       parking_slot_id,
//     } = req.body;

//     /* ─────────────────────────────
//        Validation
//     ───────────────────────────── */
//     if (!vehicle_name || !vehicle_number || !vehicle_type) {
//       return res.status(400).json({
//         message: "vehicle_name, vehicle_number and vehicle_type are required",
//       });
//     }

//     const primaryResidentId = await getPrimaryResidentId(req.user.id);
//     const resolvedFlatId    = flat_id || (await getFlatIdForUser(req.user.id));

//     if (!resolvedFlatId) {
//       return res.status(400).json({
//         message: "No flat found for this user. Contact admin.",
//       });
//     }

//     /* ─────────────────────────────
//        Duplicate Vehicle Check
//     ───────────────────────────── */
//     const duplicate = await Vehicle.findOne({
//       where: {
//         vehicle_number: vehicle_number.toUpperCase(),
//         society_id:     req.user.society_id,
//       },
//     });

//     if (duplicate) {
//       return res.status(400).json({
//         message: "This vehicle number is already registered in the society.",
//       });
//     }

//     /* ─────────────────────────────
//        Validate Selected Slot

//        TWO cases:
//        A) DEFAULT slot pre-assigned to THIS flat
//           → status is "ASSIGNED" (permanent, never goes AVAILABLE)
//           → allowed as long as no vehicle currently using it
//        B) Any other slot (EXTRA from global pool)
//           → must be status = "AVAILABLE"
//     ───────────────────────────── */
//     let linkedSlotRecord = null;

//     if (parking_slot_id) {

//       /* Step 1: find the slot in this society */
//       linkedSlotRecord = await ParkingSlot.findOne({
//         where: {
//           id:         parking_slot_id,
//           society_id: req.user.society_id,
//         },
//       });

//       if (!linkedSlotRecord) {
//         return res.status(400).json({
//           message: "Selected parking slot not found.",
//         });
//       }

//       /* Step 2: determine if this is the flat's own DEFAULT slot */
//       const isOwnDefaultSlot =
//         linkedSlotRecord.parking_type === "DEFAULT" &&
//         linkedSlotRecord.flat_id      === resolvedFlatId;

//       /* Step 3: availability check
//          — own DEFAULT slot → ASSIGNED is fine (belongs to flat permanently)
//          — any other slot   → must be AVAILABLE                              */
//       if (!isOwnDefaultSlot && linkedSlotRecord.status !== "AVAILABLE") {
//         return res.status(400).json({
//           message: "Selected parking slot is not available.",
//         });
//       }

//       /* Step 4: vehicle type must match slot type */
//       if (linkedSlotRecord.vehicle_type !== vehicle_type.toUpperCase()) {
//         return res.status(400).json({
//           message: "Vehicle type does not match parking slot type.",
//         });
//       }

//       /* Step 5: double-check no vehicle already pointing to this slot */
//       const slotInUse = await Vehicle.findOne({
//         where: {
//           parking_slot_id,
//           society_id: req.user.society_id,
//         },
//       });

//       if (slotInUse) {
//         return res.status(400).json({
//           message: "Selected parking slot is already occupied.",
//         });
//       }
//     }

//     /* ─────────────────────────────
//        Create Vehicle
//     ───────────────────────────── */
//     const vehicle = await Vehicle.create({
//       vehicle_name,
//       vehicle_number:  vehicle_number.toUpperCase(),
//       vehicle_type:    vehicle_type.toUpperCase(),
//       resident_id:     primaryResidentId,
//       flat_id:         resolvedFlatId,
//       society_id:      req.user.society_id,
//       parking_slot_id: parking_slot_id || null,
//     });

//     /* ─────────────────────────────
//        Update Slot Status

//        A) Own DEFAULT slot → just ensure ASSIGNED,
//           never touch flat_id / resident_id / parking_type
//           (they are already correctly set by admin)

//        B) EXTRA slot from global pool → claim it fully,
//           set flat_id + resident_id + parking_type = EXTRA
//     ───────────────────────────── */
//     if (parking_slot_id) {

//       const isOwnDefaultSlot =
//         linkedSlotRecord.parking_type === "DEFAULT" &&
//         linkedSlotRecord.flat_id      === resolvedFlatId;

//       if (isOwnDefaultSlot) {
//         /* DEFAULT — only update status, leave everything else untouched */
//         await ParkingSlot.update(
//           { status: "ASSIGNED" },
//           { where: { id: parking_slot_id } }
//         );
//       } else {
//         /* EXTRA from pool — claim it fully for this flat */
//         await ParkingSlot.update(
//           {
//             status:       "ASSIGNED",
//             flat_id:      resolvedFlatId,
//             resident_id:  primaryResidentId,
//             parking_type: "EXTRA",
//           },
//           { where: { id: parking_slot_id } }
//         );
//       }
//     }

//     /* ─────────────────────────────
//        No slot linked → create PENDING
//        resident request so admin sees
//        it in Extra Slot Requests panel
//     ───────────────────────────── */
//     if (!parking_slot_id) {
//       const { ParkingRequest, Notification, User } = require("../models");

//       // Guard: don't duplicate a pending request for same vehicle
//       const existingRequest = await ParkingRequest.findOne({
//         where: {
//           society_id:     req.user.society_id,
//           vehicle_number: vehicle_number.toUpperCase(),
//           parking_type:   "RESIDENT",
//           status:         "PENDING",
//         },
//       });

//       if (!existingRequest) {
//         const requester = await User.findByPk(req.user.id, {
//           attributes: ["name"],
//         });

//         const pendingRequest = await ParkingRequest.create({
//           society_id:       req.user.society_id,
//           resident_id:      primaryResidentId,
//           flat_id:          resolvedFlatId,
//           guest_name:       requester?.name || "Resident",
//           vehicle_number:   vehicle_number.toUpperCase(),
//           vehicle_type:     vehicle_type.toUpperCase(),
//           expected_arrival: new Date(),
//           duration_hours:   0,
//           status:           "PENDING",
//           parking_type:     "RESIDENT",
//           vehicle_id:       vehicle.id,
//         });

//         // Notify all admins
//         const adminUsers = await User.findAll({
//           where:      { society_id: req.user.society_id, role: "ADMIN" },
//           attributes: ["id", "fcm_token"],
//         });

//         for (const admin of adminUsers) {
//           await Notification.create({
//             society_id:       req.user.society_id,
//             receiver_user_id: admin.id,
//             title:            "Extra Parking Slot Request 🅿️",
//             message:          `${requester?.name || "A resident"} needs a ${vehicle_type.toUpperCase()} parking slot for vehicle ${vehicle_number.toUpperCase()}.`,
//             type:             "PARKING",
//             action_type:      "VIEW_PARKING",
//             action_route:     "/admin/parking",
//             is_read:          false,
//           });

//           global.io?.to(`user_${admin.id}`).emit("parking_request_new", pendingRequest);
//         }

//         // Confirm to resident
//         await Notification.create({
//           society_id:       req.user.society_id,
//           receiver_user_id: primaryResidentId,
//           title:            "Parking Slot Request Submitted ✅",
//           message:          `Your request for a ${vehicle_type.toUpperCase()} parking slot for ${vehicle_number.toUpperCase()} has been sent to the admin.`,
//           type:             "PARKING",
//           action_type:      "VIEW_PARKING",
//           action_route:     "/resident/parking",
//           is_read:          false,
//         });

//         global.io?.to(`user_${primaryResidentId}`).emit("parking_request_new", pendingRequest);
//       }
//     }

//     /* ─────────────────────────────
//        Response Parking Type
//     ───────────────────────────── */
//     const responseParkingType = linkedSlotRecord?.parking_type || "EXTRA";

//     /* ─────────────────────────────
//        Final Response
//     ───────────────────────────── */
//     return res.status(201).json({
//       ...vehicle.toJSON(),
//       slot_linked:  !!parking_slot_id,
//       parking_type: responseParkingType,
//       slot: linkedSlotRecord
//         ? {
//             id:            linkedSlotRecord.id,
//             slot_number:   linkedSlotRecord.slot_number,
//             parking_floor: linkedSlotRecord.parking_floor,
//             parking_type:  linkedSlotRecord.parking_type,
//             vehicle_type:  linkedSlotRecord.vehicle_type,
//           }
//         : null,
//     });

//   } catch (err) {
//     console.error("ADD VEHICLE ERROR:", err);
//     return res.status(500).json({ message: "Server Error" });
//   }
// };
const addVehicle = async (req, res) => {
  try {
    const {
      vehicle_name,
      vehicle_number,
      vehicle_type,
      flat_id,
      parking_slot_id,
    } = req.body;

    /* ─────────────────────────────
       Validation
    ───────────────────────────── */
    if (!vehicle_name || !vehicle_number || !vehicle_type) {
      return res.status(400).json({
        message: "vehicle_name, vehicle_number and vehicle_type are required",
      });
    }

    const primaryResidentId = await getPrimaryResidentId(req.user.id);
    const resolvedFlatId    = flat_id || (await getFlatIdForUser(req.user.id));

    if (!resolvedFlatId) {
      return res.status(400).json({
        message: "No flat found for this user. Contact admin.",
      });
    }

    /* ─────────────────────────────
       Duplicate Vehicle Check
    ───────────────────────────── */
    const duplicate = await Vehicle.findOne({
      where: {
        vehicle_number: vehicle_number.toUpperCase(),
        society_id:     req.user.society_id,
      },
    });

    if (duplicate) {
      return res.status(400).json({
        message: "This vehicle number is already registered in the society.",
      });
    }

    /* ─────────────────────────────
       Validate Selected Slot

       THREE cases:
       A) DEFAULT slot pre-assigned to THIS flat
          → status "ASSIGNED", parking_type "DEFAULT", flat_id matches
          → allowed as long as no vehicle currently using it

       B) EXTRA slot already approved & assigned to THIS flat
          → status "ASSIGNED", parking_type "EXTRA", flat_id matches
          → allowed as long as no vehicle currently using it

       C) Any fresh slot from global pool
          → must be status = "AVAILABLE"
          → will be claimed as EXTRA
    ───────────────────────────── */
    let linkedSlotRecord = null;

    if (parking_slot_id) {

      /* Step 1: find the slot in this society */
      linkedSlotRecord = await ParkingSlot.findOne({
        where: {
          id:         parking_slot_id,
          society_id: req.user.society_id,
        },
      });

      if (!linkedSlotRecord) {
        return res.status(400).json({
          message: "Selected parking slot not found.",
        });
      }

      /* Step 2: does this slot already belong to this flat? */
      const isOwnAssignedSlot =
        linkedSlotRecord.flat_id === resolvedFlatId &&
        linkedSlotRecord.status  === "ASSIGNED";

      /* Step 3: availability check
         — own slot (any type, already assigned to this flat) → OK
         — any other slot → must be AVAILABLE                        */
      if (!isOwnAssignedSlot && linkedSlotRecord.status !== "AVAILABLE") {
        return res.status(400).json({
          message: "Selected parking slot is not available.",
        });
      }

      /* Step 4: vehicle type must match slot type */
      if (linkedSlotRecord.vehicle_type !== vehicle_type.toUpperCase()) {
        return res.status(400).json({
          message: "Vehicle type does not match parking slot type.",
        });
      }

      /* Step 5: double-check no vehicle already pointing to this slot */
      const slotInUse = await Vehicle.findOne({
        where: {
          parking_slot_id,
          society_id: req.user.society_id,
        },
      });

      if (slotInUse) {
        return res.status(400).json({
          message: "Selected parking slot is already occupied.",
        });
      }
    }

    /* ─────────────────────────────
       Create Vehicle
    ───────────────────────────── */
    const vehicle = await Vehicle.create({
      vehicle_name,
      vehicle_number:  vehicle_number.toUpperCase(),
      vehicle_type:    vehicle_type.toUpperCase(),
      resident_id:     primaryResidentId,
      flat_id:         resolvedFlatId,
      society_id:      req.user.society_id,
      parking_slot_id: parking_slot_id || null,
    });

    /* ─────────────────────────────
       Update Slot Status

       A) Own DEFAULT slot → keep parking_type as DEFAULT, only touch status
       B) Own EXTRA slot   → keep parking_type as EXTRA, only touch status
       C) Fresh slot       → claim fully as EXTRA for this flat
    ───────────────────────────── */
    if (parking_slot_id) {

      const isOwnDefaultSlot =
        linkedSlotRecord.flat_id      === resolvedFlatId &&
        linkedSlotRecord.status       === "ASSIGNED"     &&
        linkedSlotRecord.parking_type === "DEFAULT";

      const isOwnExtraSlot =
        linkedSlotRecord.flat_id      === resolvedFlatId &&
        linkedSlotRecord.status       === "ASSIGNED"     &&
        linkedSlotRecord.parking_type === "EXTRA";

      if (isOwnDefaultSlot || isOwnExtraSlot) {
        /* Already belongs to this flat — only touch status, preserve everything */
        await ParkingSlot.update(
          { status: "ASSIGNED" },
          { where: { id: parking_slot_id } }
        );
      } else {
        /* Fresh slot from global pool — claim it as EXTRA for this flat */
        await ParkingSlot.update(
          {
            status:       "ASSIGNED",
            flat_id:      resolvedFlatId,
            resident_id:  primaryResidentId,
            parking_type: "EXTRA",
          },
          { where: { id: parking_slot_id } }
        );
      }
    }

    /* ─────────────────────────────
       No slot linked → create PENDING
       resident request so admin sees
       it in Extra Slot Requests panel
    ───────────────────────────── */
    if (!parking_slot_id) {
      const { ParkingRequest, Notification, User } = require("../models");

      // Guard: don't duplicate a pending request for same vehicle
      const existingRequest = await ParkingRequest.findOne({
        where: {
          society_id:     req.user.society_id,
          vehicle_number: vehicle_number.toUpperCase(),
          parking_type:   "RESIDENT",
          status:         "PENDING",
        },
      });

      if (!existingRequest) {
        const requester = await User.findByPk(req.user.id, {
          attributes: ["name"],
        });

        const pendingRequest = await ParkingRequest.create({
          society_id:       req.user.society_id,
          resident_id:      primaryResidentId,
          flat_id:          resolvedFlatId,
          guest_name:       requester?.name || "Resident",
          vehicle_number:   vehicle_number.toUpperCase(),
          vehicle_type:     vehicle_type.toUpperCase(),
          expected_arrival: new Date(),
          duration_hours:   0,
          status:           "PENDING",
          parking_type:     "RESIDENT",
          vehicle_id:       vehicle.id,
        });

        // Notify all admins
        const adminUsers = await User.findAll({
          where:      { society_id: req.user.society_id, role: "ADMIN" },
          attributes: ["id", "fcm_token"],
        });

        for (const admin of adminUsers) {
          await Notification.create({
            society_id:       req.user.society_id,
            receiver_user_id: admin.id,
            title:            "Extra Parking Slot Request 🅿️",
            message:          `${requester?.name || "A resident"} needs a ${vehicle_type.toUpperCase()} parking slot for vehicle ${vehicle_number.toUpperCase()}.`,
            type:             "PARKING",
            action_type:      "VIEW_PARKING",
            action_route:     "/admin/parking",
            is_read:          false,
          });

          global.io?.to(`user_${admin.id}`).emit("parking_request_new", pendingRequest);
        }

        // Confirm to resident
        await Notification.create({
          society_id:       req.user.society_id,
          receiver_user_id: primaryResidentId,
          title:            "Parking Slot Request Submitted ✅",
          message:          `Your request for a ${vehicle_type.toUpperCase()} parking slot for ${vehicle_number.toUpperCase()} has been sent to the admin.`,
          type:             "PARKING",
          action_type:      "VIEW_PARKING",
          action_route:     "/resident/parking",
          is_read:          false,
        });

        global.io?.to(`user_${primaryResidentId}`).emit("parking_request_new", pendingRequest);
      }
    }

    /* ─────────────────────────────
       Final Response
       — if slot is linked, return its actual parking_type from DB
       — for a fresh slot just claimed, we set it to EXTRA above
         so linkedSlotRecord.parking_type may still say "DEFAULT"
         (stale local object), so we compute the real response type here
    ───────────────────────────── */
    let responseParkingType = "EXTRA"; // default when no slot

    if (linkedSlotRecord) {
      const isOwnDefaultSlot =
        linkedSlotRecord.flat_id      === resolvedFlatId &&
        linkedSlotRecord.parking_type === "DEFAULT";

      // Only call it DEFAULT if it's genuinely this flat's own default slot
      // Everything else (own EXTRA or freshly claimed) = EXTRA
      responseParkingType = isOwnDefaultSlot ? "DEFAULT" : "EXTRA";
    }

    /* ─────────────────────────────
       Final Response
    ───────────────────────────── */
    return res.status(201).json({
      ...vehicle.toJSON(),
      slot_linked:  !!parking_slot_id,
      parking_type: responseParkingType,
      slot: linkedSlotRecord
        ? {
            id:            linkedSlotRecord.id,
            slot_number:   linkedSlotRecord.slot_number,
            parking_floor: linkedSlotRecord.parking_floor,
            parking_type:  responseParkingType, // ← use computed value, not stale DB object
            vehicle_type:  linkedSlotRecord.vehicle_type,
          }
        : null,
    });

  } catch (err) {
    console.error("ADD VEHICLE ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};
/* ══════════════════════════════════════════════════
   GET /vehicles/my
   Returns all vehicles for this resident, each enriched
   with full slot info (slot_number, parking_floor, parking_type etc.)
   parking_type is sourced from the ParkingSlot row, NOT from Vehicle.
══════════════════════════════════════════════════ */
const getMyVehicles = async (req, res) => {
  try {
    const primaryResidentId = await getPrimaryResidentId(req.user.id);

    const vehicles = await Vehicle.findAll({
      where: {
        resident_id: primaryResidentId,
        society_id:  req.user.society_id,
      },
      order: [["createdAt", "ASC"]],
    });

    const enriched = await Promise.all(
      vehicles.map(async (v) => {
        let slotInfo = null;

        if (v.parking_slot_id) {
          const slot = await ParkingSlot.findByPk(v.parking_slot_id, {
            attributes: [
              "id",
              "slot_number",
              "vehicle_type",
              "parking_floor",
              "parking_type", // ✅ parking_type lives here, on the slot
              "status",
            ],
          });
          slotInfo = slot ? slot.toJSON() : null;
        }

        const vehicleJson = v.toJSON();

        return {
          ...vehicleJson,
          slot:         slotInfo,
          // ✅ parking_type sourced from the linked slot, not from the vehicle row
          parking_type: slotInfo?.parking_type || null,
        };
      })
    );

    return res.json(enriched);
  } catch (err) {
    console.error("GET MY VEHICLES ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/* ══════════════════════════════════════════════════
   DELETE /vehicles/:id
   Removes the vehicle row only.
   ParkingSlot stays ASSIGNED to the flat so the next
   vehicle for that flat can claim it immediately
   without any admin intervention.
══════════════════════════════════════════════════ */
const deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({
      where: { id: req.params.id, society_id: req.user.society_id },
    });

    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

    /* ─────────────────────────────
       Handle parking slot cleanup
    ───────────────────────────── */
    if (vehicle.parking_slot_id) {
      const slot = await ParkingSlot.findOne({
        where: {
          id:         vehicle.parking_slot_id,
          society_id: req.user.society_id,
        },
      });

      if (slot && slot.parking_type === "EXTRA") {
        /* EXTRA slot → fully reset, clean slate back to pool */
        await slot.update({
          status:       "AVAILABLE",
          flat_id:      null,
          resident_id:  null,
          parking_type: "DEFAULT",  // ✅ clean reset
        });

        /* Cancel the APPROVED RESIDENT request tied to this slot */
        const { ParkingRequest } = require("../models");
        await ParkingRequest.update(
          { status: "COMPLETED" },
          {
            where: {
              society_id:    req.user.society_id,
              assigned_spot: slot.slot_number,
              parking_type:  "RESIDENT",
              status:        "APPROVED",
            },
          }
        );
      }

      /* DEFAULT slot → do absolutely nothing.
         Stays ASSIGNED to the flat permanently. */
    }

    /* ─────────────────────────────
       Cancel any PENDING slot request
       for this vehicle number
    ───────────────────────────── */
    const { ParkingRequest } = require("../models");
    await ParkingRequest.update(
      { status: "REJECTED" },
      {
        where: {
          society_id:     req.user.society_id,
          vehicle_number: vehicle.vehicle_number,
          parking_type:   "RESIDENT",
          status:         "PENDING",
        },
      }
    );

    await vehicle.destroy();

    return res.json({ message: "Vehicle removed" });

  } catch (err) {
    console.error("DELETE VEHICLE ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};
module.exports = { addVehicle, getMyVehicles, deleteVehicle };