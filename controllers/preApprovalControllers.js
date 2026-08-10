
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

  return await GuardShift.findOne({
    where: {
      society_id,
      shift_type: shiftType,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });
};

/* ── SEND NOTIFICATION (COMMON) ── */
const sendNotification = async ({
  societyId,
  userId,
  title,
  message,
  actionRoute,
}) => {
  const notification = await Notification.create({
    society_id: societyId,
    receiver_user_id: userId,
    title,
    message,
    type: "PARKING",
    action_type: "VIEW_PARKING",
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

    return res.status(201).json({
      message: "Pre-approval created successfully",
      GatePass: code,
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

    console.log("VERIFY BODY:", { code, slot_number, vehicle_type });

    const shift = await getOnDutyGuard(req.user.society_id);
    if (!shift || Number(shift.guard_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: "You are not on duty" });
    }

    const approval = await VisitorPreApproval.findOne({
      where: {
        otp: code,
        society_id: req.user.society_id,
        status: "PENDING",
      },
    });

    if (!approval) {
      return res.status(400).json({ message: "Invalid gate pass code" });
    }

    const today = getTodayIST();
    if (approval.valid_date < today) {
      approval.status = "EXPIRED";
      await approval.save();
      return res.status(400).json({ message: "Gate pass expired" });
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

    res.json({
      message: "Gate pass verified successfully",
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

    res.json(passes);
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