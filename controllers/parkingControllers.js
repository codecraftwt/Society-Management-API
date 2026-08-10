const {
  ParkingRequest,
  ParkingSlot,
  Flat,
  User,
  Notification,
  GuardShift,
  HouseHoldMember,
  VisitorLog,
} = require("../models");

const Vehicle = require("../models/Vehicle");
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");

/* ── IST helpers ── */
const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const getCurrentISTHour = () =>
  parseInt(
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour:     "numeric",
      hour12:   false,
    }),
    10
  );

const getCurrentShiftType = () => {
  const hour = getCurrentISTHour();
  if (hour >= 8  && hour < 16) return "MORNING";
  if (hour >= 16 && hour < 24) return "AFTERNOON";
  return "NIGHT";
};

/* ── Check guard is on active shift ── */
const getActiveShiftForGuard = async (guardId, societyId) => {
  const today     = getTodayIST();
  const shiftType = getCurrentShiftType();
  return await GuardShift.findOne({
    where: {
      guard_id:   guardId,
      society_id: societyId,
      shift_type: shiftType,
      start_date: { [Op.lte]: today },
      end_date:   { [Op.gte]: today },
    },
  });
};

/* ── Get all on-duty guard IDs ── */
const getOnDutyGuardIds = async (societyId) => {
  const today     = getTodayIST();
  const shiftType = getCurrentShiftType();
  const shifts = await GuardShift.findAll({
    where: {
      society_id: societyId,
      shift_type: shiftType,
      start_date: { [Op.lte]: today },
      end_date:   { [Op.gte]: today },
    },
    attributes: ["guard_id"],
  });
  return shifts.map((s) => s.guard_id);
};

/* ── User → flat helpers ── */
const getFlatIdForUser = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.id;
  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) return member.flat_id;
  return null;
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

/* ── Get admin user IDs for a society ── */
const getAdminUserIds = async (societyId) => {
  const admins = await User.findAll({
    where:      { society_id: societyId, role: "ADMIN" },
    attributes: ["id"],
  });
  return admins.map((a) => a.id);
};

/* ── Send notification helper ── */
const sendNotification = async ({ societyId, userId, title, message, actionRoute }) => {
  const notification = await Notification.create({
    society_id:       societyId,
    receiver_user_id: userId,
    title,
    message,
    type:         "PARKING",
    action_type:  "VIEW_PARKING",
    action_route: actionRoute,
    is_read:      false,
  });

  if (global.io) {
    global.io.to(`user_${userId}`).emit("new_notification", notification);
  }

  const user = await User.findByPk(userId, { attributes: ["fcm_token"] });
  if (user?.fcm_token) {
    sendPushNotification(user.fcm_token, title, message, { route: actionRoute }).catch((err) =>
      console.log("Push Error:", err)
    );
  }
};

/* ═══════════════════════════════════════════════════
   1️⃣  RESIDENT CREATES VISITOR PARKING REQUEST
═══════════════════════════════════════════════════ */
const requestParking = async (req, res) => {
  try {
    const { guest_name, vehicle_number, vehicle_type, expected_arrival, duration_hours } = req.body;

    const flatId = await getFlatIdForUser(req.user.id);
    if (!flatId) return res.status(400).json({ message: "Flat not found" });

    const primaryId = await getPrimaryResidentId(req.user.id);

    const newRequest = await ParkingRequest.create({
      society_id:       req.user.society_id,
      resident_id:      primaryId,
      flat_id:          flatId,
      guest_name,
      vehicle_number:   vehicle_number.toUpperCase(),
      vehicle_type,
      expected_arrival,
      duration_hours,
      status:           "PENDING",
      parking_type:     "VISITOR",
    });

    const onDutyGuardIds = await getOnDutyGuardIds(req.user.society_id);
    for (const guardId of onDutyGuardIds) {
      await sendNotification({
        societyId:   req.user.society_id,
        userId:      guardId,
        title:       "New Parking Request 🚗",
        message:     `Guest ${guest_name} (${vehicle_number.toUpperCase()}) arriving soon.`,
        actionRoute: "/guard/parking",
      });
      global.io?.to(`user_${guardId}`).emit("parking_request_new", newRequest);
    }

    res.status(201).json(newRequest);
  } catch (err) {
    console.error("REQUEST PARKING ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   2️⃣  GUARD LOOKS UP A RESIDENT VEHICLE BY NUMBER
═══════════════════════════════════════════════════ */
const lookupResidentVehicle = async (req, res) => {
  try {
    const { vehicle_number } = req.query;
    if (!vehicle_number) return res.status(400).json({ message: "vehicle_number is required" });

    const vehicle = await Vehicle.findOne({
      where: {
        vehicle_number: vehicle_number.trim().toUpperCase(),
        society_id:     req.user.society_id,
      },
    });
    if (!vehicle) return res.status(404).json({ message: "Vehicle not registered in this society" });

    const flat = await Flat.findByPk(vehicle.flat_id, { attributes: ["id", "flat_number"] });
    if (!flat) return res.status(404).json({ message: "Resident flat not found" });

    const resident = await User.findByPk(vehicle.resident_id, { attributes: ["id", "name"] });

    res.json({
      vehicle_id:     vehicle.id,
      vehicle_number: vehicle.vehicle_number,
      vehicle_type:   vehicle.vehicle_type,
      vehicle_name:   vehicle.vehicle_name,
      resident_id:    vehicle.resident_id,
      resident_name:  resident?.name || "Unknown",
      flat_id:        vehicle.flat_id,
      flat_number:    flat.flat_number,
    });
  } catch (err) {
    console.error("LOOKUP VEHICLE ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   3️⃣  GUARD CREATES RESIDENT PARKING ENTRY
═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   3️⃣  GUARD CREATES RESIDENT PARKING ENTRY
═══════════════════════════════════════════════════ */
const createResidentParking = async (req, res) => {
  try {

    const {
      vehicle_id,
      vehicle_number,
      vehicle_type,
      resident_id,
      flat_id,
      assigned_spot,
    } = req.body;

    /* ─────────────────────────────
       Required Fields
    ───────────────────────────── */
    if (
      !vehicle_number ||
      !vehicle_type ||
      !resident_id ||
      !flat_id ||
      !assigned_spot
    ) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    /* ─────────────────────────────
       Vehicle Validation
    ───────────────────────────── */
    const vehicle = await Vehicle.findOne({
      where: {
        vehicle_number:
          vehicle_number.toUpperCase(),

        society_id:
          req.user.society_id,
      },
    });

    if (!vehicle) {
      return res.status(404).json({
        message: "Vehicle not found",
      });
    }

    /* ─────────────────────────────
       Slot Validation
    ───────────────────────────── */
    const slot = await ParkingSlot.findOne({
      where: {
        slot_number: assigned_spot,

        society_id:
          req.user.society_id,

        vehicle_type:
          vehicle_type.toUpperCase(),
      },
    });

    if (!slot) {
      return res.status(400).json({
        message:
          "Selected parking slot not found.",
      });
    }

    /* ─────────────────────────────
       Check Slot Occupancy
    ───────────────────────────── */
    const slotOccupied = await Vehicle.findOne({
      where: {
        parking_slot_id: slot.id,

        society_id:
          req.user.society_id,
      },
    });

    // allow same vehicle re-entry
    if (
      slotOccupied &&
      slotOccupied.id !== vehicle.id
    ) {
      return res.status(400).json({
        message:
          "Selected parking slot is already occupied.",
      });
    }

    /* ─────────────────────────────
       AUTO APPROVE EXTRA REQUEST
       IF VEHICLE HAS NO SLOT
    ───────────────────────────── */
    if (!vehicle.parking_slot_id) {

      // assign slot to vehicle
      await vehicle.update({
        parking_slot_id: slot.id,
      });

      // mark slot assigned
    await slot.update({

   status: "ASSIGNED",

   flat_id,

   resident_id,

   parking_type: "EXTRA",
});

      // approve pending request
      const pendingRequest =
        await ParkingRequest.findOne({
          where: {
            society_id:
              req.user.society_id,

            vehicle_number:
              vehicle_number.toUpperCase(),

            parking_type:
              "RESIDENT",

            status:
              "PENDING",
          },
        });

      if (pendingRequest) {

        await pendingRequest.update({
          status: "APPROVED",

          assigned_spot:
            slot.slot_number,
        });
      }
    }

    /* ─────────────────────────────
       Duplicate Active Entry Check
    ───────────────────────────── */
    const existing = await ParkingRequest.findOne({
      where: {
        society_id:
          req.user.society_id,

        vehicle_number:
          vehicle_number.toUpperCase(),

        parking_type:
          "RESIDENT",

        status: {
          [Op.in]: ["APPROVED"],
        },

        assigned_spot:
          assigned_spot,
      },
    });

    if (existing) {
      return res.status(400).json({
        message:
          "This vehicle already has an active parking entry.",
      });
    }

    /* ─────────────────────────────
       Resident User
    ───────────────────────────── */
    const residentUser = await User.findByPk(
      resident_id,
      {
        attributes: ["name"],
      }
    );

    /* ─────────────────────────────
       Create Resident Entry
    ───────────────────────────── */
    const entry = await ParkingRequest.create({

      society_id:
        req.user.society_id,

      resident_id,

      flat_id,

      guest_name:
        residentUser?.name || "Resident",

      vehicle_number:
        vehicle_number.toUpperCase(),

      vehicle_type:
        vehicle_type.toUpperCase(),

      expected_arrival:
        new Date(),

      duration_hours:
        24,

      status:
        "APPROVED",

      assigned_spot:
        assigned_spot,

      parking_type:
        "RESIDENT",

      vehicle_id:
        vehicle_id || vehicle.id,
    });

    /* ─────────────────────────────
       Notification
    ───────────────────────────── */
    await sendNotification({
      societyId:
        req.user.society_id,

      userId:
        resident_id,

      title:
        "Vehicle Parked 🚗",

      message:
        `Your vehicle ${vehicle_number.toUpperCase()} has been parked in spot ${assigned_spot}.`,

      actionRoute:
        "/resident/parking",
    });

    global.io
      ?.to(`user_${req.user.id}`)
      .emit(
        "parking_request_new",
        entry
      );

    global.io
      ?.to(`user_${resident_id}`)
      .emit(
        "parking_request_new",
        entry
      );

    /* ─────────────────────────────
       Final Response
    ───────────────────────────── */
    return res.status(201).json({
      message:
        "Resident parking entry created successfully",

      entry,
    });

  } catch (err) {

    console.error(
      "CREATE RESIDENT PARKING ERROR:",
      err
    );

    return res.status(500).json({
      message: "Server Error",
    });
  }
};

/* ═══════════════════════════════════════════════════
   4️⃣  GUARD ASSIGNS SLOT ON ARRIVAL (visitor flow)
═══════════════════════════════════════════════════ */
const assignParkingSlot = async (req, res) => {
  try {
    const { id }            = req.params;
    const { assigned_spot } = req.body;

    const activeShift = await getActiveShiftForGuard(req.user.id, req.user.society_id);
    if (!activeShift) return res.status(403).json({ message: "You are not on duty right now." });

    if (!assigned_spot) return res.status(400).json({ message: "Parking spot is required" });

    const request = await ParkingRequest.findByPk(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "PENDING")
      return res.status(400).json({ message: "Only PENDING requests can be assigned a slot" });

    const slot = await ParkingSlot.findOne({
      where: {
        slot_number:  assigned_spot,
        society_id:   request.society_id,
        vehicle_type: request.vehicle_type,
        status:       "AVAILABLE",
      },
    });
    if (!slot) return res.status(400).json({ message: "Slot not available or vehicle type mismatch" });

    slot.status = "ASSIGNED";
    await slot.save();

    request.status        = "APPROVED";
    request.assigned_spot = assigned_spot;
    await request.save();

    if (request.parking_type === "VISITOR") {
      try {
        await VisitorLog.create({
          society_id:     request.society_id,
          flat_id:        request.flat_id,
          visitor_name:   request.guest_name,
          mobile:         "N/A",
          purpose:        "GUEST",
          vehicle_number: request.vehicle_number,
          guard_id:       req.user.id,
          entry_time:     new Date(),
          exit_time:      null,
        });
      } catch (e) { console.error("Visitor log creation error:", e); }
    }

    await sendNotification({
      societyId:   request.society_id,
      userId:      request.resident_id,
      title:       "Parking Slot Assigned 🅿️",
      message:     `Your guest ${request.guest_name} has been assigned spot ${assigned_spot}.`,
      actionRoute: "/resident/parking",
    });

    const onDutyGuardIds = await getOnDutyGuardIds(request.society_id);
    for (const guardId of onDutyGuardIds) {
      global.io?.to(`user_${guardId}`).emit("parking_request_updated", request);
    }
    global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

    res.json(request);
  } catch (err) {
    console.error("ASSIGN SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   5️⃣  GUARD REJECTS A VISITOR REQUEST
═══════════════════════════════════════════════════ */
const rejectParkingRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const activeShift = await getActiveShiftForGuard(req.user.id, req.user.society_id);
    if (!activeShift) return res.status(403).json({ message: "You are not on duty right now." });

    const request = await ParkingRequest.findByPk(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "PENDING")
      return res.status(400).json({ message: "Only PENDING requests can be rejected" });

    request.status = "REJECTED";
    await request.save();

    await sendNotification({
      societyId:   request.society_id,
      userId:      request.resident_id,
      title:       "Parking Request Rejected",
      message:     `Parking request for ${request.guest_name} was rejected by the guard.`,
      actionRoute: "/resident/parking",
    });

    const onDutyGuardIds = await getOnDutyGuardIds(request.society_id);
    for (const guardId of onDutyGuardIds) {
      global.io?.to(`user_${guardId}`).emit("parking_request_updated", request);
    }
    global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

    res.json(request);
  } catch (err) {
    console.error("REJECT PARKING ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   6️⃣  GUARD MARKS EXIT
═══════════════════════════════════════════════════ */
const markExit = async (req, res) => {
  try {
    const { id } = req.params;

    const activeShift = await getActiveShiftForGuard(req.user.id, req.user.society_id);
    if (!activeShift) return res.status(403).json({ message: "You are not on duty right now." });

    const request = await ParkingRequest.findByPk(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "APPROVED")
      return res.status(400).json({ message: "Only active requests can be marked as exited" });

    if (request.assigned_spot) {
      const slot = await ParkingSlot.findOne({
        where: { slot_number: request.assigned_spot, society_id: request.society_id },
      });
      if (slot && !slot.flat_id) {
        slot.status = "AVAILABLE";
        await slot.save();
      }
    }

    request.status = "COMPLETED";
    await request.save();

    if (request.parking_type === "VISITOR") {
      try {
        const visitor = await VisitorLog.findOne({
          where: {
            society_id:     request.society_id,
            visitor_name:   request.guest_name,
            flat_id:        request.flat_id,
            vehicle_number: request.vehicle_number,
            exit_time:      null,
          },
          order: [["entry_time", "DESC"]],
        });
        if (visitor) { visitor.exit_time = new Date(); await visitor.save(); }
      } catch (e) { console.error("Visitor log exit error:", e); }
    }

    const notifMessage =
      request.parking_type === "RESIDENT"
        ? `Your vehicle ${request.vehicle_number} has exited.`
        : `${request.guest_name}'s vehicle has exited. Slot ${request.assigned_spot} is now free.`;

    await sendNotification({
      societyId:   request.society_id,
      userId:      request.resident_id,
      title:       "Vehicle Exited 🚗",
      message:     notifMessage,
      actionRoute: "/resident/parking",
    });

    const onDutyGuardIds = await getOnDutyGuardIds(request.society_id);
    for (const guardId of onDutyGuardIds) {
      global.io?.to(`user_${guardId}`).emit("parking_request_updated", request);
    }
    global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

    res.json({ message: "Exit marked", request });
  } catch (err) {
    console.error("MARK EXIT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   7️⃣  GET PARKING REQUESTS (PAGINATED FOR ALL ROLES)
═══════════════════════════════════════════════════ */
const getParkingRequests = async (req, res) => {
  try {
    const { role, id, society_id } = req.user;

    const page   = Math.max(1,   parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 5);
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim() || "";
    const filter = req.query.filter || "ALL";

    const where = { society_id };

    if (role === "RESIDENT" || role === "FAMILY_MEMBER") {
      where.resident_id = await getPrimaryResidentId(id);
      if (req.query.parking_type) {
        where.parking_type = req.query.parking_type;
      } else {
        where.parking_type = "VISITOR";
      }
    }

    if ((role === "GUARD" || role === "ADMIN") && req.query.parking_type) {
      where.parking_type = req.query.parking_type;
    }

    if (filter !== "ALL") where.status = filter;

    if (search) {
      where[Op.or] = [
        { guest_name:     { [Op.like]: `%${search}%` } },
        { vehicle_number: { [Op.like]: `%${search}%` } },
        { vehicle_type:   { [Op.like]: `%${search}%` } },
        { assigned_spot:  { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: requests } = await ParkingRequest.findAndCountAll({
      where,
      include: [
        { model: Flat, attributes: ["flat_number"] },
        { model: User, as: "resident", attributes: ["name"] },
      ],
      order:    [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    const baseWhere = { society_id };
    if (role === "RESIDENT" || role === "FAMILY_MEMBER") {
      baseWhere.resident_id  = where.resident_id;
      baseWhere.parking_type = req.query.parking_type || "VISITOR";
    }
    if ((role === "GUARD" || role === "ADMIN") && req.query.parking_type) {
      baseWhere.parking_type = req.query.parking_type;
    }

    const [totalAll, totalPending, totalApproved, totalRejected, totalCompleted] =
      await Promise.all([
        ParkingRequest.count({ where: baseWhere }),
        ParkingRequest.count({ where: { ...baseWhere, status: "PENDING"   } }),
        ParkingRequest.count({ where: { ...baseWhere, status: "APPROVED"  } }),
        ParkingRequest.count({ where: { ...baseWhere, status: "REJECTED"  } }),
        ParkingRequest.count({ where: { ...baseWhere, status: "COMPLETED" } }),
      ]);

    res.json({
      data:       requests,
      pagination: { currentPage: page, totalPages: Math.ceil(count / limit), totalItems: count, limit },
      counts:     { ALL: totalAll, PENDING: totalPending, APPROVED: totalApproved, REJECTED: totalRejected, COMPLETED: totalCompleted },
    });
  } catch (err) {
    console.error("GET PARKING ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   8️⃣  RESIDENT REQUESTS AN EXTRA SLOT FROM ADMIN
   → Only called when vehicle has NO free pre-assigned slot
     (slot occupied, no slot assigned, or user chose "request different")
   → NEVER called when link_to_assigned_slot succeeded (slot_linked=true)
   → Guards against: vehicle already has slot, duplicate pending request,
     and flat still has a free slot (shouldn't happen via normal flow)
═══════════════════════════════════════════════════ */
const requestResidentSlot = async (req, res) => {
  try {
    const { vehicle_number, vehicle_type, flat_id } = req.body;

    if (!vehicle_number || !vehicle_type) {
      return res.status(400).json({ message: "vehicle_number and vehicle_type are required" });
    }

    const resolvedFlatId    = flat_id || (await getFlatIdForUser(req.user.id));
    if (!resolvedFlatId) return res.status(400).json({ message: "Flat not found for this user" });

    const primaryResidentId = await getPrimaryResidentId(req.user.id);

    /* Guard 1: vehicle already has a slot linked → no request needed */
    const existingVehicle = await Vehicle.findOne({
      where: {
        vehicle_number: vehicle_number.toUpperCase(),
        society_id:     req.user.society_id,
      },
    });
    if (existingVehicle && existingVehicle.parking_slot_id) {
      return res.status(200).json({
        message: "Vehicle already has a parking slot linked. No request needed.",
        skipped: true,
      });
    }

    /* Guard 2: don't duplicate a pending request for same vehicle */
    const existing = await ParkingRequest.findOne({
      where: {
        society_id:     req.user.society_id,
        vehicle_number: vehicle_number.toUpperCase(),
        parking_type:   "RESIDENT",
        status:         "PENDING",
      },
    });
    if (existing) {
      return res.status(400).json({ message: "A pending slot request already exists for this vehicle" });
    }

    /* Guard 3: flat still has a free pre-assigned slot (shouldn't happen via normal flow) */
    const freeAssignedSlot = await ParkingSlot.findOne({
      where: {
        society_id:   req.user.society_id,
        flat_id:      resolvedFlatId,
        vehicle_type: vehicle_type.toUpperCase(),
        status:       "ASSIGNED",
      },
    });
    if (freeAssignedSlot) {
      const slotInUse = await Vehicle.findOne({
        where: {
          parking_slot_id: freeAssignedSlot.id,
          society_id:      req.user.society_id,
        },
      });
      if (!slotInUse) {
        return res.status(400).json({
          message: "Your flat has a free pre-assigned slot. Please link it directly instead of requesting a new one.",
          free_slot: freeAssignedSlot.slot_number,
        });
      }
    }

    const requester = await User.findByPk(req.user.id, { attributes: ["name"] });

    const newRequest = await ParkingRequest.create({
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
    });

    /* Notify all admins */
    const adminIds = await getAdminUserIds(req.user.society_id);
    for (const adminId of adminIds) {
      await sendNotification({
        societyId:   req.user.society_id,
        userId:      adminId,
        title:       "Extra Parking Slot Request 🅿️",
        message:     `${requester?.name || "A resident"} needs an extra ${vehicle_type} parking slot (${vehicle_number.toUpperCase()}).`,
        actionRoute: "/admin/parking",
      });
      global.io?.to(`user_${adminId}`).emit("parking_request_new", newRequest);
    }

    /* Confirm to resident */
    await sendNotification({
      societyId:   req.user.society_id,
      userId:      primaryResidentId,
      title:       "Extra Slot Request Submitted ✅",
      message:     `Your request for an extra ${vehicle_type} parking slot has been sent to the admin.`,
      actionRoute: "/resident/parking",
    });

    res.status(201).json(newRequest);
  } catch (err) {
    console.error("REQUEST RESIDENT SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   9️⃣  ADMIN ASSIGNS EXTRA SLOT TO A RESIDENT REQUEST
   → Route: PUT /parking/:id/admin-assign
   → Marks ParkingSlot as ASSIGNED with flat_id + resident_id
   → Links vehicle.parking_slot_id so resident sees it immediately
   → Sets vehicle.parking_type = EXTRA (confirmed overflow)
═══════════════════════════════════════════════════ */
// const adminAssignResidentSlot = async (req, res) => {
//   try {
//     const { id }            = req.params;
//     const { assigned_spot } = req.body;

//     if (!assigned_spot) return res.status(400).json({ message: "assigned_spot is required" });

//     const request = await ParkingRequest.findByPk(id);
//     if (!request)                                    return res.status(404).json({ message: "Request not found" });
//     if (request.society_id !== req.user.society_id)  return res.status(403).json({ message: "Not authorized" });
//     if (request.status !== "PENDING")                return res.status(400).json({ message: "Only PENDING requests can be assigned" });
//     if (request.parking_type !== "RESIDENT")         return res.status(400).json({ message: "This endpoint is only for RESIDENT type requests" });

//     const slot = await ParkingSlot.findOne({
//       where: {
//         slot_number:  assigned_spot,
//         society_id:   req.user.society_id,
//         vehicle_type: request.vehicle_type,
//         status:       "AVAILABLE",
//       },
//     });
//     if (!slot) return res.status(400).json({ message: "Slot not available or vehicle type mismatch" });

//     /* Permanently assign slot to flat + resident */
//     slot.status      = "ASSIGNED";
//     slot.flat_id     = request.flat_id;
//     slot.resident_id = request.resident_id;
//     await slot.save();

//     request.status        = "APPROVED";
//     request.assigned_spot = assigned_spot;
//     await request.save();

//     /* Link the vehicle's parking_slot_id so resident sees it immediately in MyVehicles */
//     const vehicle = await Vehicle.findOne({
//       where: {
//         vehicle_number: request.vehicle_number,
//         society_id:     req.user.society_id,
//       },
//     });
//     if (vehicle) {
//       vehicle.parking_slot_id = slot.id;
//       await vehicle.save();
//     }

//     await sendNotification({
//       societyId:   request.society_id,
//       userId:      request.resident_id,
//       title:       "Extra Parking Slot Assigned 🅿️",
//       message:     `Your vehicle ${request.vehicle_number} has been assigned extra parking slot ${assigned_spot}.`,
//       actionRoute: "/resident/parking",
//     });

//     global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

//     res.json({ message: "Slot assigned successfully", request, slot });
//   } catch (err) {
//     console.error("ADMIN ASSIGN RESIDENT SLOT ERROR:", err);
//     res.status(500).json({ message: "Server Error" });
//   }
// };


const adminAssignResidentSlot = async (req, res) => {
  try {
    const { id }            = req.params;
    const { assigned_spot } = req.body;

    if (!assigned_spot) return res.status(400).json({ message: "assigned_spot is required" });

    const request = await ParkingRequest.findByPk(id);
    if (!request)                                   return res.status(404).json({ message: "Request not found" });
    if (request.society_id !== req.user.society_id) return res.status(403).json({ message: "Not authorized" });
    if (request.status !== "PENDING")               return res.status(400).json({ message: "Only PENDING requests can be assigned" });
    if (request.parking_type !== "RESIDENT")        return res.status(400).json({ message: "This endpoint is only for RESIDENT type requests" });

    const slot = await ParkingSlot.findOne({
      where: {
        slot_number:  assigned_spot,
        society_id:   req.user.society_id,
        vehicle_type: request.vehicle_type,
        status:       "AVAILABLE",
      },
    });
    if (!slot) return res.status(400).json({ message: "Slot not available or vehicle type mismatch" });

    /* ✅ FIX: always mark as EXTRA when admin assigns via resident request */
    slot.status       = "ASSIGNED";
    slot.flat_id      = request.flat_id;
    slot.resident_id  = request.resident_id;
    slot.parking_type = "EXTRA";              // ← this was missing
    await slot.save();

    request.status        = "APPROVED";
    request.assigned_spot = assigned_spot;
    await request.save();

    /* Link the vehicle's parking_slot_id so resident sees it immediately */
    const vehicle = await Vehicle.findOne({
      where: {
        vehicle_number: request.vehicle_number,
        society_id:     req.user.society_id,
      },
    });
    if (vehicle) {
      vehicle.parking_slot_id = slot.id;
      await vehicle.save();
    }

    await sendNotification({
      societyId:   request.society_id,
      userId:      request.resident_id,
      title:       "Extra Parking Slot Assigned 🅿️",
      message:     `Your vehicle ${request.vehicle_number} has been assigned extra parking slot ${assigned_spot}.`,
      actionRoute: "/resident/parking",
    });

    global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

    res.json({ message: "Slot assigned successfully", request, slot });
  } catch (err) {
    console.error("ADMIN ASSIGN RESIDENT SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};
/* ═══════════════════════════════════════════════════
   🆕  GET ALL RESIDENT VEHICLES WITH NO PARKING SLOT
   → Route: GET /parking/unassigned-resident-vehicles
   → Used by admin Resident Entry panel
═══════════════════════════════════════════════════ */
const getUnassignedResidentVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.findAll({
      where: {
        parking_slot_id: null,
        resident_id:     { [Op.not]: null },
        society_id:      req.user.society_id,
      },
      order: [["createdAt", "DESC"]],
    });

    const data = await Promise.all(
      vehicles.map(async (v) => {
        const flat = v.flat_id
          ? await Flat.findByPk(v.flat_id, { attributes: ["id", "flat_number"] })
          : null;

        const resident = v.resident_id
          ? await User.findByPk(v.resident_id, { attributes: ["id", "name"] })
          : null;

        return {
          vehicle_id:     v.id,
          vehicle_number: v.vehicle_number,
          vehicle_name:   v.vehicle_name,
          vehicle_type:   v.vehicle_type,
          resident_id:    v.resident_id,
          resident_name:  resident?.name || "Unknown",
          flat_id:        v.flat_id,
          flat_number:    flat?.flat_number || null,
        };
      })
    );

    return res.json(data);
  } catch (err) {
    console.error("GET UNASSIGNED VEHICLES ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════════════════
   🆕  ADMIN REJECTS A RESIDENT EXTRA SLOT REQUEST
   → Route: PUT /parking/:id/admin-reject
   → No shift check (admin, not guard)
═══════════════════════════════════════════════════ */
const adminRejectResidentSlot = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await ParkingRequest.findByPk(id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.society_id !== req.user.society_id)
      return res.status(403).json({ message: "Not authorized" });
    if (request.status !== "PENDING")
      return res.status(400).json({ message: "Only PENDING requests can be rejected" });
    if (request.parking_type !== "RESIDENT")
      return res.status(400).json({ message: "This endpoint is only for RESIDENT type requests" });

    request.status = "REJECTED";
    await request.save();

    await sendNotification({
      societyId:   request.society_id,
      userId:      request.resident_id,
      title:       "Extra Slot Request Rejected",
      message:     `Your extra parking slot request for vehicle ${request.vehicle_number} was rejected by the admin.`,
      actionRoute: "/resident/parking",
    });

    global.io?.to(`user_${request.resident_id}`).emit("parking_request_updated", request);

    res.json({ message: "Request rejected", request });
  } catch (err) {
    console.error("ADMIN REJECT RESIDENT SLOT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
};
/* ═══════════════════════════════════════════════════
   🆕  ADMIN REJECTS UNASSIGNED VEHICLE
   → Cancels PENDING resident request
   → Deletes the vehicle row
   → Notifies resident
   → Route: POST /parking/admin-cancel-vehicle-request
═══════════════════════════════════════════════════ */
const adminCancelVehicleRequest = async (req, res) => {
  try {
    const { vehicle_number, vehicle_id } = req.body;

    if (!vehicle_number && !vehicle_id) {
      return res.status(400).json({ message: "vehicle_number or vehicle_id required" });
    }

    /* 1. Cancel all PENDING RESIDENT requests for this vehicle */
    const cancelled = await ParkingRequest.update(
      { status: "REJECTED" },
      {
        where: {
          society_id:     req.user.society_id,
          vehicle_number: vehicle_number?.toUpperCase(),
          parking_type:   "RESIDENT",
          status:         "PENDING",
        },
      }
    );

    /* 2. Find and delete the vehicle */
    const vehicle = await Vehicle.findOne({
      where: {
        ...(vehicle_id     ? { id: vehicle_id }                                        : {}),
        ...(vehicle_number ? { vehicle_number: vehicle_number.toUpperCase() }          : {}),
        society_id: req.user.society_id,
        parking_slot_id: null,   // safety: only delete if still unassigned
      },
    });

    if (!vehicle) {
      return res.status(404).json({ message: "Unassigned vehicle not found" });
    }

    const residentId = vehicle.resident_id;

    await vehicle.destroy();

    /* 3. Notify resident */
    await Notification.create({
      society_id:       req.user.society_id,
      receiver_user_id: residentId,
      title:            "Vehicle Registration Rejected ❌",
      message:          `Your vehicle ${vehicle_number?.toUpperCase()} could not be assigned a parking slot and has been removed. Please contact the admin for more info.`,
      type:             "PARKING",
      action_type:      "VIEW_PARKING",
      action_route:     "/resident/parking",
      is_read:          false,
    });

    global.io?.to(`user_${residentId}`).emit("parking_request_updated", {
      vehicle_number,
      status: "REJECTED",
    });

    return res.json({ message: "Vehicle rejected and removed successfully" });

  } catch (err) {
    console.error("ADMIN CANCEL VEHICLE REQUEST ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};
// Add to module.exports:
module.exports = {
  requestParking,
  lookupResidentVehicle,
  createResidentParking,
  assignParkingSlot,
  rejectParkingRequest,
  markExit,
  getParkingRequests,
  requestResidentSlot,
  adminAssignResidentSlot,
  adminRejectResidentSlot,       // ← add
  getUnassignedResidentVehicles, 
  adminCancelVehicleRequest,// ← add
};