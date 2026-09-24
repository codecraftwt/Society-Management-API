
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");
const {
  sanitizeText,
  isEmpty,
  isValidMobile,
  isValidPersonName,
  isValidTitle,
  isValidISODate,
} = require("../utils/validation");
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

/* ── IST helpers + shift timing (single source of truth) ── */
const { getCurrentISTDate, getCurrentISTMinutes } = require("../utils/istTime");
const { getShiftTimings, isTimeInShift } = require("../utils/shiftTiming");
const getTodayIST = () => getCurrentISTDate();

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
  const today   = getTodayIST();
  const timings = await getShiftTimings(society_id);
  const minutes = getCurrentISTMinutes();

  const shifts = await GuardShift.findAll({
    where: {
      society_id,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  const active = shifts.find((s) => isTimeInShift(timings, s.shift_type, minutes));

  if (!active) {
    const allShifts = await GuardShift.findAll({ where: { society_id }, attributes: ["id", "guard_id", "shift_type", "start_date", "end_date"] });
    console.log(`[getOnDutyGuard] No active shift found. All shifts for society:`, JSON.stringify(allShifts));
  } else {
    console.log(`[getOnDutyGuard] Found shift: guard_id=${active.guard_id}, shift_type=${active.shift_type}`);
  }

  return active;
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
      pass_type,
      valid_until,
      daily_limit,
      dwell_minutes,
    } = req.body;

    const cleanName = sanitizeText(visitor_name);
    const cleanMobile = sanitizeText(mobile);
    const resolvedType = String(pass_type || "SINGLE").toUpperCase() === "DAILY" ? "DAILY" : "SINGLE";
    const resolvedDwell = Number(dwell_minutes);

    if (isEmpty(flat_id)) {
      return res.status(400).json({ message: "Flat is required." });
    }
    if (!isValidPersonName(cleanName) && !isValidTitle(cleanName)) {
      return res.status(400).json({
        message: "Visitor name is required and must be at least 2 characters.",
      });
    }
    if (!isValidMobile(cleanMobile)) {
      return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }
    if (isEmpty(purpose)) {
      return res.status(400).json({ message: "Purpose is required." });
    }
    if (!valid_date) {
      return res.status(400).json({ message: "Valid date is required." });
    }
    if (!isValidISODate(String(valid_date).slice(0, 10))) {
      return res.status(400).json({ message: "Valid date must be a valid date." });
    }
    if (vehicle_number && isEmpty(sanitizeText(vehicle_number))) {
      return res.status(400).json({ message: "Vehicle number cannot be empty." });
    }

    // Dwell limit: positive integer (1..1440 minutes). Legacy clients omit it → 45.
    const dwell =
      !dwell_minutes || !Number.isInteger(resolvedDwell) || resolvedDwell < 1 || resolvedDwell > 1440
        ? 45
        : resolvedDwell;

    // Daily pass: require an end date >= start date, and a sane daily scan limit.
    let scansPerDay = 2;
    if (resolvedType === "DAILY") {
      if (!valid_until) {
        return res.status(400).json({ message: "Daily pass requires an end date (valid_until)." });
      }
      if (!isValidISODate(String(valid_until).slice(0, 10))) {
        return res.status(400).json({ message: "End date must be a valid date." });
      }
      if (String(valid_until).slice(0, 10) < String(valid_date).slice(0, 10)) {
        return res.status(400).json({ message: "End date cannot be before the start date." });
      }
      const limit = Number(daily_limit);
      scansPerDay = Number.isInteger(limit) && limit >= 1 ? limit : 2;
    }

    // ✅ Security: Ensure owners can't pre-approve for rented flats
    if (req.user.resident_type === "OWNER") {
      const flat = await Flat.findByPk(flat_id);
      if (flat && flat.occupancy_status === "RENTED") {
        return res.status(403).json({
          message: "Owners cannot pre-approve visitors for units that are currently rented to a tenant.",
        });
      }
    }

    // ✅ Check for existing active gate pass for this helper on this unit/time period
    const startDateStr = String(valid_date).slice(0, 10);
    const endDateStr = resolvedType === "DAILY" ? String(valid_until).slice(0, 10) : startDateStr;

    const existingActivePass = await VisitorPreApproval.findOne({
      where: {
        society_id: req.user.society_id,
        flat_id,
        mobile: cleanMobile,
        status: { [Op.in]: ["PENDING", "APPROVED"] },
        [Op.or]: [
          {
            pass_type: "DAILY",
            valid_date: { [Op.lte]: endDateStr },
            valid_until: { [Op.gte]: startDateStr },
          },
          {
            pass_type: "SINGLE",
            valid_date: startDateStr,
          },
        ],
      },
      order: [["createdAt", "DESC"]],
    });

    if (existingActivePass) {
      const society = await Society.findByPk(req.user.society_id, { attributes: ["id", "name"] });
      return res.status(409).json({
        message: `An active gate pass (${existingActivePass.otp}) already exists for this helper for this time period.`,
        alreadyExists: true,
        GatePass: existingActivePass.otp,
        society_name: society?.name || null,
        preApproval: existingActivePass,
      });
    }

    // ✅ Generate gate pass
    const code = generateGatePass();

    const newPreApproval = await VisitorPreApproval.create({
      resident_id: req.user.id,
      society_id: req.user.society_id,
      flat_id,

      visitor_name: cleanName,
      mobile: cleanMobile,
      vehicle_number: vehicle_number ? sanitizeText(vehicle_number) : null,
      purpose,
      valid_date,

      pass_type: resolvedType,
      valid_until: resolvedType === "DAILY" ? String(valid_until).slice(0, 10) : null,
      daily_limit: resolvedType === "DAILY" ? scansPerDay : 2,
      dwell_minutes: dwell,

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
/* ── Start of an IST calendar day as a UTC instant ── */
const startOfISTDay = (istDate) => new Date(`${istDate}T00:00:00+05:30`);

/* ── Free visitor parking once the visitor exits (mirrors visitor markExit) ── */
const freeVisitorParking = async (visitorLog) => {
  if (!visitorLog.vehicle_number) return;

  const parkingReq = await ParkingRequest.findOne({
    where: {
      society_id:     visitorLog.society_id,
      flat_id:        visitorLog.flat_id,
      vehicle_number: visitorLog.vehicle_number.toUpperCase(),
      parking_type:   "VISITOR",
      status:         "APPROVED",
    },
    order: [["createdAt", "DESC"]],
  });

  if (!parkingReq) return;

  await parkingReq.update({ status: "COMPLETED" });

  if (parkingReq.assigned_spot) {
    const slot = await ParkingSlot.findOne({
      where: {
        slot_number: parkingReq.assigned_spot,
        society_id:  visitorLog.society_id,
      },
    });
    if (slot && !slot.flat_id) {
      await slot.update({ status: "AVAILABLE" });
    }
  }
};

/* ═══════════════════════════════════════════
   2️⃣  VERIFY GATE PASS  (GUARD)
       ✅ FIXED: Only create entry when slot is provided
       ✅ DAILY passes: max 2 scans per IST day (entry/exit), resets daily
       ✅ dwell_minutes snapshot + response fields for guard UI
═══════════════════════════════════════════ */
const verifyGatePass = async (req, res) => {
  try {
    const { code, slot_number, vehicle_type } = req.body;

    console.log("VERIFY BODY:", { code, slot_number, vehicle_type, guard_id: req.user.id, society_id: req.user.society_id });

    const today    = getTodayIST();
    const timings  = await getShiftTimings(req.user.society_id);
    const minutes  = getCurrentISTMinutes();
    const myShift  = await GuardShift.findOne({
      where: {
        guard_id: req.user.id,
        society_id: req.user.society_id,
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today },
      },
    });

    if (!myShift || !isTimeInShift(timings, myShift.shift_type, minutes)) {
      return res.status(403).json({ message: `No active shift assigned to you right now. You are off duty.` });
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

    const isDaily = String(approval.pass_type || "SINGLE").toUpperCase() === "DAILY";

    // ── Validity by pass type ──
    if (isDaily) {
      if (today < approval.valid_date) {
        return res.status(400).json({
          message: `This daily pass is not active yet. It is valid from ${approval.valid_date}.`,
          notYetValid: true,
          visitor_name: approval.visitor_name || null,
        });
      }

      if (approval.valid_until && approval.valid_until < today) {
        approval.status = "EXPIRED";
        await approval.save();
        return res.status(400).json({
          message: "Gate pass expired",
          expired: true,
          visitor_name: approval.visitor_name || null,
        });
      }
    } else if (approval.valid_date < today) {
      approval.status = "EXPIRED";
      await approval.save();
      return res.status(400).json({
        message: "Gate pass expired",
        expired: true,
        visitor_name: approval.visitor_name || null,
      });
    }

    // ── DAILY PASS FLOW ──
    // Status stays PENDING across days. Each IST day is capped at `daily_limit`
    // scans: first = entry, second = exit. The cap resets each new day.
    if (isDaily) {
      const dayStart = startOfISTDay(today);
      const dayEnd   = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const todayScans = await VisitorLog.count({
        where: {
          preapproval_id: approval.id,
          entry_time: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
        },
      });

      const openLog = await VisitorLog.findOne({
        where: { preapproval_id: approval.id, exit_time: null },
        order: [["entry_time", "DESC"]],
      });

      // Open log present → this scan closes the day's visit (EXIT)
      if (openLog) {
        openLog.exit_time = new Date();
        await openLog.save();

        await freeVisitorParking(openLog);

        return res.json({
          scan_type: "exit",
          scan_label: "EXIT",
          message: "Visitor exit recorded successfully",
          visitor_name: openLog.visitor_name,
          visitor: openLog,
          pass_type: "DAILY",
          dwell_minutes: openLog.dwell_minutes || approval.dwell_minutes,
          usesToday: todayScans,
          dailyLimit: approval.daily_limit,
        });
      }

      // Day quota exhausted → reject
      if (todayScans >= approval.daily_limit) {
        return res.status(400).json({
          message: `This daily pass is used up for today. Maximum ${approval.daily_limit} scans per day — try again tomorrow.`,
          dailyLimited: true,
          usesToday: todayScans,
          dailyLimit: approval.daily_limit,
          visitor_name: approval.visitor_name || null,
        });
      }

      // ENTRY
      const flat = approval.flat_id
        ? await Flat.findByPk(approval.flat_id)
        : await Flat.findOne({ where: { resident_id: approval.resident_id } });

      if (!flat) {
        return res.status(400).json({ message: "Flat not found" });
      }

      if (approval.vehicle_number && !slot_number) {
        return res.status(400).json({
          message: "Please select a parking slot",
          requiresSlot: true,
        });
      }

      const visitor = await VisitorLog.create({
        visitor_name: approval.visitor_name,
        purpose: approval.purpose,
        flat_id: flat.id,
        mobile: approval.mobile,
        vehicle_number: approval.vehicle_number,
        guard_id: req.user.id,
        society_id: req.user.society_id,
        preapproval_id: approval.id,
        dwell_minutes: approval.dwell_minutes,
      });

      let parkingRequest = null;
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
          await visitor.destroy();
          return res.status(400).json({ message: "Slot not available or vehicle type mismatch" });
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
          parking_type: "VISITOR",
        });
      }

      // NOTE: daily pass status stays PENDING (daily usage tracked via logs)

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

      return res.json({
        scan_type: "entry",
        scan_label: "ENTRY",
        message: "Gate pass verified successfully",
        society_name: society?.name || null,
        visitor_name: approval.visitor_name,
        visitor,
        parkingRequest,
        pass_type: "DAILY",
        dwell_minutes: approval.dwell_minutes,
        usesToday: todayScans + 1,
        dailyLimit: approval.daily_limit,
      });
    }

    // ── SINGLE (legacy) PASS FLOW — unchanged two-scan cycle ──
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

      await freeVisitorParking(openLog);

      return res.json({
        scan_type: "exit",
        scan_label: "EXIT",
        message: "Visitor exit recorded successfully",
        visitor_name: openLog.visitor_name,
        visitor: openLog,
        pass_type: "SINGLE",
        dwell_minutes: openLog.dwell_minutes || approval.dwell_minutes,
      });
    }

    // ✅ FIX: Resolve the ACTUAL flat the pass was created for. Pre-approvals
    //    store flat_id, so a multi-property resident's pass must be logged
    //    against that flat — NOT the first flat found by resident_id (which
    //    could be a different / rented-out unit). Only fall back to the
    //    resident lookup for legacy passes created before flat_id was added.
    const flat = approval.flat_id
      ? await Flat.findByPk(approval.flat_id)
      : await Flat.findOne({ where: { resident_id: approval.resident_id } });

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
      dwell_minutes: approval.dwell_minutes,
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
      pass_type: "SINGLE",
      dwell_minutes: approval.dwell_minutes,
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

    // 2. Expire old pending passes (single passes past their valid date,
    //    daily passes past their validity range)
    await VisitorPreApproval.update(
      { status: "EXPIRED" },
      {
        where: {
          status: "PENDING",
          [Op.or]: [
            { pass_type: { [Op.ne]: "DAILY" }, valid_date: { [Op.lt]: today } },
            { pass_type: "DAILY", valid_until: { [Op.lt]: today } },
          ],
        },
      },
    );

    // 3. Fetch ALL passes for user's flats (Pending + Used + Expired)
    //    This is the single source of truth for both Web and App, so they
    //    display the exact same set of passes.
    const passes = await VisitorPreApproval.findAll({
      where: {
        flat_id: { [Op.in]: myFlatIds },
      },
      include: [
        {
          model: Flat,
          attributes: ["flat_number"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // 5. Attach society names + flat number, plus today's usage for
    //    active daily passes (2-scan/day budget shown to resident + guard)
    const societyIds = [...new Set(passes.map((p) => p.society_id))];
    const societies = await Society.findAll({ where: { id: societyIds }, attributes: ["id", "name"] });
    const societyMap = Object.fromEntries(societies.map((s) => [s.id, s.name]));

    const dayStart = startOfISTDay(today);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dailyIds = passes
      .filter((p) => p.status === "PENDING" && String(p.pass_type || "").toUpperCase() === "DAILY")
      .map((p) => p.id);

    let todayCounts = {};
    if (dailyIds.length) {
      const logs = await VisitorLog.findAll({
        where: {
          preapproval_id: { [Op.in]: dailyIds },
          entry_time: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
        },
        attributes: ["preapproval_id"],
      });
      todayCounts = logs.reduce((acc, l) => {
        acc[l.preapproval_id] = (acc[l.preapproval_id] || 0) + 1;
        return acc;
      }, {});
    }

    const passesWithFlat = passes.map((p) => {
      const json = p.toJSON();
      const { Flat, ...rest } = json;
      void Flat;
      return {
        ...rest,
        flat_number: p.Flat?.flat_number || null,
        society_name: societyMap[p.society_id] || null,
        uses_today:
          String(p.pass_type || "").toUpperCase() === "DAILY"
            ? todayCounts[p.id] || 0
            : undefined,
      };
    });

    // PENDING first, then by created date desc within each status
    const statusRank = { PENDING: 0, USED: 1, EXPIRED: 2 };
    const ranked = passesWithFlat.sort((a, b) => {
      const diff = (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
      if (diff !== 0) return diff;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.json(ranked);
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