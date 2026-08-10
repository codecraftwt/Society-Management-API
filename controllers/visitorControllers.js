

const VisitorLog     = require("../models/VisitorLog");
const Flat           = require("../models/Flat");
const Floor          = require("../models/Floor");
const Block          = require("../models/Block");
const Notification   = require("../models/Notification");
const UserSetting    = require("../models/UserSetting");
const User           = require("../models/User");
const ParkingSlot    = require("../models/ParkingSlot");
const ParkingRequest = require("../models/ParkingRequest");
const HouseHoldMember = require("../models/HouseHoldMember");
const GuardShift     = require("../models/GuardShift");
const FlatMembership = require("../models/FlatMembership");

const { sendPushNotification } = require("../utils/pushNotification");
const { Op }                   = require("sequelize");

/* ─────────────────────────────────────────────
   IST HELPERS
───────────────────────────────────────────── */

const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const getCurrentISTHour = () =>
  parseInt(
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10
  );

const getCurrentShiftType = () => {
  const hour = getCurrentISTHour();
  if (hour >= 8  && hour < 16) return "MORNING";
  if (hour >= 16 && hour < 24) return "AFTERNOON";
  return "NIGHT";
};

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

/* ─────────────────────────────────────────────
   ADD VISITOR  (Smart Routing)

   • If the guard also supplies vehicle_number + assigned_slot,
     we create a ParkingRequest (parking_type = "VISITOR") and
     mark that ParkingSlot as ASSIGNED.
   • The slot is freed again in markExit below.
   • DEFAULT / EXTRA concepts do NOT apply to visitor parking.
───────────────────────────────────────────── */
const addVisitor = async (req, res) => {
  try {
    const {
      flat_id,
      visitor_name,
      mobile,
      purpose,
      vehicle_number,
      assigned_slot,   // slot_number string sent by the guard UI
    } = req.body;

    /* ── Shift guard ── */
    const activeShift = await getActiveShiftForGuard(
      req.user.id,
      req.user.society_id
    );
    if (!activeShift) {
      return res.status(403).json({
        message: `You are not on duty right now (${getCurrentShiftType()} shift).`,
      });
    }

    /* ── Resolve primary contact for this flat ── */
    const activeMembers = await FlatMembership.findAll({
      where:   { flat_id, is_current: true },
      include: [{ model: User, attributes: ["id", "fcm_token"] }],
    });

    if (!activeMembers.length) {
      return res.status(404).json({ message: "No active residents found for this flat." });
    }

    let targetMember =
      activeMembers.find((m) => m.role === "TENANT" && m.is_staying) ||
      activeMembers.find((m) => m.role === "OWNER");

    if (!targetMember) {
      return res.status(404).json({ message: "Could not determine primary contact for this flat." });
    }

    const targetUserId = targetMember.user_id;

    /* ── Create VisitorLog ── */
    const newVisitor = await VisitorLog.create({
      flat_id,
      guard_id:       req.user.id,
      society_id:     req.user.society_id,
      visitor_name,
      mobile,
      purpose:        purpose || "GUEST",
      vehicle_number: vehicle_number || null,
    });

    /* ── If a vehicle + slot were provided, create ParkingRequest ──
       parking_type = "VISITOR"  →  no DEFAULT/EXTRA, purely transient.
       The slot is freed again in markExit below.
    ── */
    if (vehicle_number && assigned_slot) {
      const slot = await ParkingSlot.findOne({
        where: {
          slot_number: assigned_slot,
          society_id:  req.user.society_id,
          status:      "AVAILABLE",
        },
      });

      if (!slot) {
        console.warn(
          `[addVisitor] Slot "${assigned_slot}" not found or not AVAILABLE — ` +
          `VisitorLog ${newVisitor.id} created without parking record.`
        );
      } else {
        await slot.update({ status: "ASSIGNED" });

        await ParkingRequest.create({
          society_id:       req.user.society_id,
          resident_id:      targetUserId,
          flat_id,
          guest_name:       visitor_name,
          vehicle_number:   vehicle_number.toUpperCase(),
          vehicle_type:     req.body.vehicle_type || "CAR",
          expected_arrival: new Date(),
          duration_hours:   4,
          status:           "APPROVED",
          assigned_spot:    assigned_slot,
          parking_type:     "VISITOR",
        });
      }
    }

    /* ── Socket notification ── */
    if (global.io) {
      global.io.to(`user_${targetUserId}`).emit("new_visitor", newVisitor);
    }

    /* ── Push notification ── */
    if (targetMember.User?.fcm_token) {
      sendPushNotification(
        targetMember.User.fcm_token,
        "New Visitor",
        `${visitor_name} is at the gate for ${purpose || "GUEST"}.`,
        { type: "GATE_APPROVAL", visitorId: newVisitor.id }
      ).catch(console.error);
    }

    res.status(201).json({
      message: "Visitor logged & resident notified",
      visitor: newVisitor,
    });
  } catch (error) {
    console.error("❌ [addVisitor] ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};

/* ─────────────────────────────────────────────
   MARK EXIT

   • After saving exit_time on the VisitorLog, we also:
     1. Find the matching VISITOR ParkingRequest (if any)
     2. Mark it COMPLETED
     3. Free the ParkingSlot back to AVAILABLE
        — only if the slot has no flat_id (i.e. not a
          permanently assigned resident slot).
───────────────────────────────────────────── */
const markExit = async (req, res) => {
  try {
    const visitor = await VisitorLog.findByPk(req.params.id);
    if (!visitor)                                    return res.status(404).json({ message: "Visitor not found" });
    if (visitor.society_id !== req.user.society_id) return res.status(403).json({ message: "Unauthorized" });

    const activeShift = await getActiveShiftForGuard(req.user.id, req.user.society_id);
    if (!activeShift) {
      return res.status(403).json({
        message: `You are not on duty right now (${getCurrentShiftType()} shift).`,
      });
    }

    visitor.exit_time = new Date();
    await visitor.save();

    /* ── Free visitor parking if it existed ── */
    if (visitor.vehicle_number) {
      const parkingReq = await ParkingRequest.findOne({
        where: {
          society_id:     visitor.society_id,
          flat_id:        visitor.flat_id,
          vehicle_number: visitor.vehicle_number.toUpperCase(),
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
              society_id:  visitor.society_id,
            },
          });
          // flat_id on a ParkingSlot means it belongs to a resident permanently —
          // do NOT reset those. Guest slots have flat_id = null.
          if (slot && !slot.flat_id) {
            await slot.update({ status: "AVAILABLE" });
          }
        }
      }
    }

    res.json({ message: "Visitor exit marked successfully" });
  } catch (err) {
    console.error("❌ [markExit] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────
   GET SOCIETY VISITORS  (paginated, for admin/guard)
───────────────────────────────────────────── */
const getSocietyVisitors = async (req, res) => {
  try {
    const page   = Math.max(1,   parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const filter = req.query.filter || "ALL";
    const search = req.query.search || "";
    const { society_id, block_id, floor_id, flat_id } = req.query;

    const activeSocId = req.user.society_id || society_id;
    const where = {};
    if (activeSocId) where.society_id = activeSocId;

    if (filter === "IN")  where.exit_time = null;
    if (filter === "OUT") where.exit_time = { [Op.ne]: null };
    if (search)           where.visitor_name = { [Op.like]: `%${search}%` };

    if (flat_id) where.flat_id = flat_id;

    const flatWhere = {};
    if (block_id) flatWhere.block_id = block_id;
    if (floor_id) flatWhere.floor_id = floor_id;

    /* ── Count breakdown for stat pills (ALL / IN / OUT) ── */
    const [allCount, inCount, outCount] = await Promise.all([
      VisitorLog.count({ where: { society_id: activeSocId || { [Op.ne]: null } } }),
      VisitorLog.count({ where: { society_id: activeSocId || { [Op.ne]: null }, exit_time: null } }),
      VisitorLog.count({ where: { society_id: activeSocId || { [Op.ne]: null }, exit_time: { [Op.ne]: null } } }),
    ]);

    const { count, rows } = await VisitorLog.findAndCountAll({
      where,
      include: [
        {
          model:    Flat,
          where:    Object.keys(flatWhere).length > 0 ? flatWhere : undefined,
          required: Object.keys(flatWhere).length > 0,
          attributes: ["id", "flat_number", "block_id", "floor_id"],
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
      order:  [["entry_time", "DESC"]],
      limit,
      offset,
    });

    res.json({
      data:       rows,
      counts:     { ALL: allCount, IN: inCount, OUT: outCount },
      pagination: {
        totalPages:  Math.ceil(count / limit),
        currentPage: page,
        totalItems:  count,
      },
    });
  } catch (err) {
    console.error("❌ [getSocietyVisitors] ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────
   GET RESIDENT VISITORS  (paginated, for resident)
───────────────────────────────────────────── */
const getResidentVisitors = async (req, res) => {
  try {
    const userId = req.user.id;
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || "ALL";
    const search = req.query.search || "";

    const userMemberships = await FlatMembership.findAll({
      where:      { user_id: userId, is_current: true },
      attributes: ["flat_id"],
    });
    const myFlatIds = userMemberships.map((m) => m.flat_id);

    if (myFlatIds.length === 0) {
      return res.status(200).json({
        visitors:      [],
        totalPages:    0,
        currentPage:   page,
        totalVisitors: 0,
        counts:        { ALL: 0, INSIDE: 0, LEFT: 0 },
      });
    }

    const baseWhere = { flat_id: { [Op.in]: myFlatIds } };
    if (search) baseWhere.visitor_name = { [Op.like]: `%${search}%` };

    const [allCount, insideCount, leftCount] = await Promise.all([
      VisitorLog.count({ where: baseWhere }),
      VisitorLog.count({ where: { ...baseWhere, exit_time: null } }),
      VisitorLog.count({ where: { ...baseWhere, exit_time: { [Op.ne]: null } } }),
    ]);

    const whereClause = { ...baseWhere };
    if (filter === "INSIDE") whereClause.exit_time = null;
    if (filter === "LEFT")   whereClause.exit_time = { [Op.ne]: null };

    const { count, rows } = await VisitorLog.findAndCountAll({
      where: whereClause,
      include: [
        {
          model:      Flat,
          attributes: ["id", "flat_number", "occupancy_status"],
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
      order:  [["entry_time", "DESC"]],
      limit,
      offset,
    });

    res.status(200).json({
      visitors:      rows,
      totalPages:    Math.ceil(count / limit),
      currentPage:   page,
      totalVisitors: count,
      counts:        { ALL: allCount, INSIDE: insideCount, LEFT: leftCount },
    });
  } catch (error) {
    console.error("❌ [getResidentVisitors] ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};

/* ─────────────────────────────────────────────
   GET SOCIETY BLOCKS FOR GUARD
───────────────────────────────────────────── */
const getSocietyBlocksForGuard = async (req, res) => {
  try {
    const blocks = await Block.findAll({
      where:      { society_id: req.user.society_id },
      attributes: ["id", "name"],
    });
    res.json(blocks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ─────────────────────────────────────────────
   RESPOND TO GATE REQUEST
───────────────────────────────────────────── */
const respondToGateRequest = async (req, res) => {
  try {
    const { id }     = req.params;
    const { action } = req.body;

    const visitor = await VisitorLog.findByPk(id);
    if (!visitor) return res.status(404).json({ message: "Visitor not found" });

    if (action === "deny" || action === "leave_at_gate") {
      visitor.exit_time = new Date();
      await visitor.save();
    }

    const guard = await User.findByPk(visitor.guard_id);
    if (guard?.fcm_token) {
      const messages = {
        approve:       `✅ Resident APPROVED entry for ${visitor.visitor_name}.`,
        deny:          `❌ Resident DENIED entry for ${visitor.visitor_name}.`,
        leave_at_gate: `📦 Parcel to be left at gate for ${visitor.visitor_name}.`,
      };
      await sendPushNotification(
        guard.fcm_token,
        "Gate Update",
        messages[action] || "Gate update.",
        { type: "GUARD_ALERT" }
      );
    }

    res.json({ message: "Action processed successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  addVisitor,
  markExit,
  getSocietyVisitors,
  getResidentVisitors,
  getSocietyBlocksForGuard,
  respondToGateRequest,
};