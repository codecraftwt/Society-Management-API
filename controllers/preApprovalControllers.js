
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");
const VisitorPreApproval = require("../models/VisitorPreApproval");
const VisitorLog = require("../models/VisitorLog");
const Flat = require("../models/Flat");
const HouseHoldMember = require("../models/HouseHoldMember");
const Notification = require("../models/Notification");
const GuardShift = require("../models/GuardShift");
const ParkingRequest = require("../models/ParkingRequest"); // 🔥
const ParkingSlot = require("../models/ParkingSlot"); // 🔥 was missing
const User = require("../models/User"); // 🔥 REQUIRED
const Society = require("../models/Society");
// const VisitorPreApproval = require("../models/VisitorPreApproval");
const FlatMembership = require("../models/FlatMembership");

/* ── IST date helper ── */
const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/* ── Current IST hour (0-23) ── */
const getCurrentISTHour = () =>
  parseInt(
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );

/* ── Shift logic ── */
const getCurrentShiftType = () => {
  const hour = getCurrentISTHour();
  if (hour >=  8 && hour < 16) return "MORNING";
  if (hour >= 16 && hour < 24) return "AFTERNOON";
  return "NIGHT";
};

/* ── Generate gate pass ── */
const generateGatePass = () =>
  "GP-" + Math.floor(100000 + Math.random() * 900000);

/* ── Resolve primary resident from user id ── */
const getPrimaryResidentId = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.resident_id;

  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) {
    const f = await Flat.findByPk(member.flat_id);
    if (f && f.resident_id) return f.resident_id;
  }

  return userId;
};

/* ── Get on-duty guard for society ── */
const getOnDutyGuard = async (society_id) => {
  const today = getTodayIST();
  const shiftType = getCurrentShiftType();

  console.log(`[getOnDutyGuard] society_id=${society_id}, shift_type=${shiftType}, today=${today}`);

  const shift = await GuardShift.findOne({
    where: {
      society_id,
      shift_type: shiftType,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  if (!shift) {
    const allShifts = await GuardShift.findAll({ where: { society_id }, attributes: ["id", "guard_id", "shift_type", "start_date", "end_date"] });
    console.log(`[getOnDutyGuard] No active shift found. All shifts for society:`, JSON.stringify(allShifts));
  } else {
    console.log(`[getOnDutyGuard] Found shift: guard_id=${shift.guard_id}, shift_type=${shift.shift_type}`);
  }

  return shift;
};

/* ── SEND NOTIFICATION (COMMON) ── */
const sendNotification = async ({
  societyId,
  userId,
  title,
  message,
  actionRoute,
  type = "PARKING",
  actionType = "VIEW_PARKING",
}) => {
  const notification = await Notification.create({
    society_id: societyId,
    receiver_user_id: userId,
    title,
    message,
    type,
    action_type: actionType,
    action_route: actionRoute,
    is_read: false,
  });

  if (global.io) {
    console.log("SOCKET EMIT TO:", `user_${userId}`);
    global.io.to(`user_${userId}`).emit("new_notification", notification);
  }

  const user = await User.findByPk(userId, { attributes: ["fcm_token"] });

  if (user?.fcm_token) {
    sendPushNotification(user.fcm_token, title, message, {
      route: actionRoute,
    }).catch((err) => console.log("Push Error:", err));
  }
};

/* ── NOTIFY ONLY ON-DUTY GUARD ── */
const notifyOnDutyGuard = async (societyId, title, message, actionRoute) => {
  const shift = await getOnDutyGuard(societyId);

  if (!shift) {
    console.log("❌ No guard on duty");
    return;
  }

  console.log("✅ NOTIFYING GUARD:", shift.guard_id);

  await sendNotification({
    societyId,
    userId: shift.guard_id, // 🔥 ONLY CURRENT SHIFT GUARD
    title,
    message,
    actionRoute,
  });
};

/* ═══════════════════════════════════════════
   1️⃣  CREATE PRE-APPROVAL  (RESIDENT)
═══════════════════════════════════════════ */
// const createPreApproval = async (req, res) => {
//   try {
//     const code = generateGatePass();
//     const primaryId = await getPrimaryResidentId(req.user.id);

//     const approval = await VisitorPreApproval.create({
//       visitor_name: req.body.visitor_name,
//       mobile: req.body.mobile,
//       purpose: req.body.purpose,
//       vehicle_number: req.body.vehicle_number,
//       otp: code,
//       resident_id: primaryId,
//       society_id: req.user.society_id,
//       valid_date: req.body.valid_date,
//       status: "PENDING",
//     });

//     /* 🔥 NOTIFY GUARD */
//     await notifyOnDutyGuard(
//       req.user.society_id,
//       "New Visitor Request",
//       `Visitor ${req.body.visitor_name} is expected`,
//       "/guard/visitor"
//     );

//     res.status(201).json({
//       ...approval.toJSON(),
//       GatePass: code,
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

 const createPreApproval = async (req, res) => {
  try {
    const {
      flat_id,
      visitor_name,
      mobile,
      vehicle_number,
      purpose,
      valid_date,
    } = req.body;

    // ✅ Security: Ensure owners can't pre-approve for rented flats
    if (req.user.resident_type === "OWNER") {
      const flat = await Flat.findByPk(flat_id);
      if (flat && flat.occupancy_status === "RENTED") {
        return res.status(403).json({
          message: "Owners cannot pre-approve visitors for units that are currently rented to a tenant.",
        });
      }
    }

    // ✅ Generate gate pass
    const code = generateGatePass();

    const newPreApproval = await VisitorPreApproval.create({
      resident_id: req.user.id,
      society_id: req.user.society_id,
      flat_id,

      visitor_name,
      mobile,
      vehicle_number: vehicle_number || null,
      purpose,
      valid_date,

      otp: code,
      status: "PENDING",
    });

    const society = await Society.findByPk(req.user.society_id, { attributes: ["id", "name"] });

    return res.status(201).json({
      message: "Pre-approval created successfully",
      GatePass: code,
      society_name: society?.name || null,
      preApproval: newPreApproval,
    });
  } catch (error) {
    console.error("❌ ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ═══════════════════════════════════════════
   2️⃣  VERIFY GATE PASS  (GUARD)
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   2️⃣  VERIFY GATE PASS  (GUARD)
       ✅ FIXED: Only create entry when slot is provided
═══════════════════════════════════════════ */
const verifyGatePass = async (req, res) => {
  try {
    const { code, slot_number, vehicle_type } = req.body;

    console.log("VERIFY BODY:", { code, slot_number, vehicle_type, guard_id: req.user.id, society_id: req.user.society_id });

    const today = getTodayIST();
    const currentShiftType = getCurrentShiftType();
    const myShift = await GuardShift.findOne({
      where: {
        guard_id: req.user.id,
        society_id: req.user.society_id,
        shift_type: currentShiftType,
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today },
      },
    });

    if (!myShift) {
      return res.status(403).json({ message: `No active ${currentShiftType} shift assigned to you for today. You are off duty.` });
    }

    const approval = await VisitorPreApproval.findOne({
      where: {
        otp: code,
        society_id: req.user.society_id,
        status: { [Op.in]: ["PENDING", "USED"] },
      },
    });

    if (!approval) {
      // ✅ Pass may already be flagged EXPIRED earlier — give guard a clear reason
      const expiredPass = await VisitorPreApproval.findOne({
        where: {
          otp: code,
          society_id: req.user.society_id,
          status: "EXPIRED",
        },
      });

      if (expiredPass) {
        return res.status(400).json({
          message: "Gate pass expired",
          expired: true,
          visitor_name: expiredPass.visitor_name || null,
        });
      }

      return res.status(400).json({ message: "Invalid gate pass code" });
    }

    if (approval.valid_date < today) {
      approval.status = "EXPIRED";
      await approval.save();
      return res.status(400).json({
        message: "Gate pass expired",
        expired: true,
        visitor_name: approval.visitor_name || null,
      });
    }

    // ✅ SECOND SCAN = EXIT (pass was already used for entry)
    if (approval.status === "USED") {
      const openLog = await VisitorLog.findOne({
        where: {
          preapproval_id: approval.id,
          exit_time: null,
        },
        order: [["entry_time", "DESC"]],
      });

      if (!openLog) {
        return res.status(400).json({
          message: "Gate pass already scanned out. Visitor has already exited.",
          alreadyExited: true,
          visitor_name: approval.visitor_name || null,
        });
      }

      openLog.exit_time = new Date();
      await openLog.save();

      // ✅ Free visitor parking if it existed (mirrors visitor markExit)
      if (openLog.vehicle_number) {
        const parkingReq = await ParkingRequest.findOne({
          where: {
            society_id:     openLog.society_id,
            flat_id:        openLog.flat_id,
            vehicle_number: openLog.vehicle_number.toUpperCase(),
            parking_type:   "VISITOR",
            status:         "APPROVED",
          },
          order: [["createdAt", "DESC"]],
        });

        if (parkingReq) {
          await parkingReq.update({ status: "COMPLETED" });

          if (parkingReq.assigned_spot) {
            const slot = await ParkingSlot.findOne({
              where: {
                slot_number: parkingReq.assigned_spot,
                society_id:  openLog.society_id,
              },
            });
            if (slot && !slot.flat_id) {
              await slot.update({ status: "AVAILABLE" });
            }
          }
        }
      }

      return res.json({
        scan_type: "exit",
        scan_label: "EXIT",
        message: "Visitor exit recorded successfully",
        visitor_name: openLog.visitor_name,
        visitor: openLog,
      });
    }

    const flat = await Flat.findOne({
      where: { resident_id: approval.resident_id },
    });

    if (!flat) {
      return res.status(400).json({ message: "Flat not found" });
    }

    // ✅ FIX: If visitor has vehicle but no slot selected, ask for slot
    if (approval.vehicle_number && !slot_number) {
      return res.status(400).json({
        message: "Please select a parking slot",
        requiresSlot: true, // ✅ Frontend can use this flag
      });
    }

    // ✅ ONLY CREATE VISITOR LOG AFTER SLOT IS SELECTED (or if no vehicle)
    const visitor = await VisitorLog.create({
      visitor_name: approval.visitor_name,
      purpose: approval.purpose,
      flat_id: flat.id,
      mobile: approval.mobile,
      vehicle_number: approval.vehicle_number,
      guard_id: req.user.id,
      society_id: req.user.society_id,
      preapproval_id: approval.id,
    });

    let parkingRequest = null;

    // ✅ Create parking entry if vehicle exists
    if (approval.vehicle_number && slot_number) {
      const resolvedType = vehicle_type || "CAR";

      const slot = await ParkingSlot.findOne({
        where: {
          slot_number,
          society_id: req.user.society_id,
          vehicle_type: resolvedType,
          status: "AVAILABLE",
        },
      });

      if (!slot) {
        // ✅ ROLLBACK: Delete the visitor log if slot assignment fails
        await visitor.destroy();
        return res.status(400).json({
          message: "Slot not available or vehicle type mismatch",
        });
      }

      slot.status = "ASSIGNED";
      await slot.save();

      parkingRequest = await ParkingRequest.create({
        society_id: req.user.society_id,
        guest_name: approval.visitor_name,
        vehicle_number: approval.vehicle_number,
        vehicle_type: resolvedType,
        flat_id: flat.id,
        resident_id: approval.resident_id,
        status: "APPROVED",
        assigned_spot: slot.slot_number,
        expected_arrival: new Date(),
        duration_hours: 24,
        parking_type: "VISITOR", // ✅ ADDED
      });
    }

    // ✅ Mark approval as used ONLY after successful entry
    approval.status = "USED";
    await approval.save();

    // ✅ Notify the resident that their guest has arrived
    sendNotification({
      societyId: req.user.society_id,
      userId: approval.resident_id,
      title: "Guest Arrived",
      message: `${approval.visitor_name} has arrived at the gate${flat ? ` for Flat ${flat.flat_number}` : ""}. Guard: ${req.user.name}`,
      actionRoute: "/resident/preapproval",
      type: "VISITOR",
      actionType: "VIEW_VISITOR",
    }).catch(err => console.log("Guest arrival notification error:", err));

    const society = await Society.findByPk(req.user.society_id, { attributes: ["id", "name"] });

    res.json({
      scan_type: "entry",
      scan_label: "ENTRY",
      message: "Gate pass verified successfully",
      society_name: society?.name || null,
      visitor_name: approval.visitor_name,
      visitor,
      parkingRequest,
    });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════════
   3️⃣  GET MY GATE PASSES  (RESIDENT)
═══════════════════════════════════════════ */
const getMyGatePasses = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayIST();

    // 1. Get all flats the user belongs to
    const FlatMembership = require("../models/FlatMembership"); // Ensure it's required
    const userMemberships = await FlatMembership.findAll({
      where: { user_id: userId, is_current: true },
      attributes: ["flat_id"],
    });

    const myFlatIds = userMemberships.map((m) => m.flat_id);

    if (myFlatIds.length === 0) {
      return res.json([]);
    }

    // 2. Expire old pending passes
    await VisitorPreApproval.update(
      { status: "EXPIRED" },
      {
        where: {
          status: "PENDING",
          valid_date: { [Op.lt]: today },
        },
      },
    );

    // 3. Fetch all active passes for user's flats
    const passes = await VisitorPreApproval.findAll({
      where: {
        flat_id: { [Op.in]: myFlatIds },
        status: "PENDING",
        valid_date: { [Op.gte]: today },
      },
      order: [["createdAt", "DESC"]],
    });

    // 4. Attach society names
    const societyIds = [...new Set(passes.map((p) => p.society_id))];
    const societies = await Society.findAll({ where: { id: societyIds }, attributes: ["id", "name"] });
    const societyMap = Object.fromEntries(societies.map((s) => [s.id, s.name]));

    const passesWithSociety = passes.map((p) => ({
      ...p.toJSON(),
      society_name: societyMap[p.society_id] || null,
    }));

    res.json(passesWithSociety);
  } catch (err) {
    console.error("❌ ERROR in getMyGatePasses:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  createPreApproval,
  verifyGatePass,
  getMyGatePasses,
};