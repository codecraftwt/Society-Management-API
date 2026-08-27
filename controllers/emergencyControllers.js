

const EmergencyAlert = require("../models/EmergencyAlert");
const GuardShift = require("../models/GuardShift");
const { User, Flat, Block, HouseHoldMember, Notification } = require("../models");
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");

const getCurrentShiftType = () => {
  const hour = new Date().getHours();
  if (hour >= 8 && hour < 16) return "MORNING";
  if (hour >= 16) return "AFTERNOON";
  return "NIGHT";
};

const getOnShiftGuardId = async (societyId) => {
  const today = new Date().toISOString().split("T")[0];
  const shiftType = getCurrentShiftType();

  const shift = await GuardShift.findOne({
    where: {
      society_id: societyId,
      shift_type: shiftType,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  return shift ? shift.guard_id : null;
};

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
    if (f && f.resident_id) return f.resident_id;
  }

  return userId;
};

const createEmergency = async (req, res) => {
  try {
    const user = req.user;
    const roles = Array.isArray(user.roles) ? user.roles : [user.role];
    const payload = {
      type: req.body.type,
      message: req.body.message,
      society_id: user.society_id,
      status: "ACTIVE",
    };

    let flatInfoStr = "";

    if (roles.includes("GUARD")) {
      payload.guard_id = user.id;
      payload.source = "GUARD";
    }

    // ✅ RESIDENT (flat mandatory)
    else if (roles.includes("RESIDENT")) {

      // Prefer client-provided flat_id (owner selecting from multiple flats),
      // fall back to auto-lookup for single-flat residents
      const flatId = req.body.flat_id
        ? parseInt(req.body.flat_id, 10)
        : await getFlatIdForUser(user.id);

      if (!flatId) {
        return res.status(400).json({
          message: "Resident must be associated with a flat to raise emergency"
        });
      }

      payload.resident_id = user.id;
      payload.flat_id = flatId;
      payload.source = "RESIDENT";

      const flatDetails = await Flat.findByPk(flatId, {
        include: [{ model: Block, attributes: ["name"] }]
      });

      if (flatDetails) {
        const blockName = flatDetails.Block ? flatDetails.Block.name : '';
        flatInfoStr = ` at Flat ${flatDetails.flat_number}, Block ${blockName}`;
      }

      const onShiftGuardId = await getOnShiftGuardId(user.society_id);
      if (onShiftGuardId) payload.guard_id = onShiftGuardId;
    }

    // ✅ FAMILY MEMBER (flat optional)
    else if (roles.includes("FAMILY_MEMBER")) {

      // Prefer client-provided flat_id, fall back to auto-lookup
      const flatId = req.body.flat_id
        ? parseInt(req.body.flat_id, 10)
        : await getFlatIdForUser(user.id);

      const primaryId = await getPrimaryResidentId(user.id);

      payload.resident_id = primaryId || user.id;
      payload.flat_id = flatId || null;
      payload.source = "RESIDENT";
      payload.message = `(Family Member: ${user.name}) - ${payload.message}`;

      if (flatId) {
        const flatDetails = await Flat.findByPk(flatId, {
          include: [{ model: Block, attributes: ["name"] }]
        });

        if (flatDetails) {
          const blockName = flatDetails.Block ? flatDetails.Block.name : '';
          flatInfoStr = ` at Flat ${flatDetails.flat_number}, Block ${blockName}`;
        }
      }

      const onShiftGuardId = await getOnShiftGuardId(user.society_id);
      if (onShiftGuardId) payload.guard_id = onShiftGuardId;
    }

    else {
      payload.source = "RESIDENT";
    }

    const emergency = await EmergencyAlert.create(payload);

    const alertTitle = `🚨 EMERGENCY: ${payload.type} 🚨`;
    const alertBody = `New emergency alert raised${flatInfoStr}: ${payload.message}`;

    // 1. Notify Guard
    if ((roles.includes("RESIDENT") || roles.includes("FAMILY_MEMBER")) && payload.guard_id) {

      const notification = await Notification.create({
        society_id: payload.society_id,
        receiver_user_id: payload.guard_id,
        title: alertTitle,
        message: alertBody,
        type: "EMERGENCY",
        action_type: "VIEW_EMERGENCY",
        action_route: "/guard/emergency",
        is_read: false
      });

      if (global.io) {
        global.io
          .to(`user_${payload.guard_id}`)
          .emit("new_notification", notification);
      }

      const guardUser = await User.findByPk(payload.guard_id, { attributes: ['fcm_token'] });

      if (guardUser && guardUser.fcm_token) {
        sendPushNotification(
          guardUser.fcm_token,
          alertTitle,
          alertBody,
          { route: "/guard/emergency", type: "EMERGENCY", alertId: String(emergency.id) }
        ).catch(err => console.error("Push Error:", err));
      }
    }

    // 2. Notify Admins
    const admins = await User.findAll({
      where: { society_id: payload.society_id, role: "SOCIETY_ADMIN" },
      attributes: ['id', 'fcm_token']
    });

    for (const admin of admins) {

      const notification = await Notification.create({
        society_id: payload.society_id,
        receiver_user_id: admin.id,
        title: alertTitle,
        message: alertBody,
        type: "EMERGENCY",
        action_type: "VIEW_EMERGENCY",
        action_route: "/admin/emergency",
        is_read: false
      });

      if (global.io) {
        global.io
          .to(`user_${admin.id}`)
          .emit("new_notification", notification);
      }

      if (admin.fcm_token) {
        sendPushNotification(
          admin.fcm_token,
          alertTitle,
          alertBody,
          { route: "/admin/emergency", type: "EMERGENCY", alertId: String(emergency.id) }
        ).catch(err => console.error("Push Error:", err));
      }
    }

    // 3. Notify Neighbors
    if (roles.includes("RESIDENT") || roles.includes("FAMILY_MEMBER")) {
      const neighbors = await User.findAll({
        where: {
          society_id: payload.society_id,
          role: "RESIDENT",
          id: { [Op.ne]: user.id }
        },
        attributes: ['id', 'fcm_token']
      });

      const neighborBody = `SOS Alert: ${payload.type} reported${flatInfoStr}. Please check if help is needed!`;

      for (const neighbor of neighbors) {
        const notification = await Notification.create({
          society_id: payload.society_id,
          receiver_user_id: neighbor.id,
          title: alertTitle,
          message: neighborBody,
          type: "EMERGENCY",
          action_type: "VIEW_EMERGENCY",
          action_route: "/resident/emergency",
          is_read: false
        });

        if (global.io) {
          global.io.to(`user_${neighbor.id}`).emit("new_notification", notification);
        }

        if (neighbor.fcm_token) {
          sendPushNotification(
            neighbor.fcm_token,
            alertTitle,
            neighborBody,
            { route: "/resident/emergency", type: "EMERGENCY", alertId: String(emergency.id) }
          ).catch(err => console.error("Push Error:", err));
        }
      }
    }

    res.status(201).json({
      ...emergency.toJSON(),
      shiftInfo: payload.guard_id
        ? `Alert routed to on-shift guard (${getCurrentShiftType()} shift)`
        : "⚠️ No guard on shift right now — alert visible to admins and neighbors",
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

const getEmergencyAlerts = async (req, res) => {
  try {
    const where = { society_id: req.user.society_id };

    if (req.user.role === "GUARD") {
      // Guard sees own alerts + any alert with no assigned on-shift guard
      where[Op.or] = [{ guard_id: req.user.id }, { guard_id: null }];
    }

    const alerts = await EmergencyAlert.findAll({
      where,
      include: [
        { model: User, as: "Resident", attributes: ["id", "name"] },
        { model: User, as: "Guard", attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    res.json(alerts);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getActiveEmergencies = async (req, res) => {
  try {
    const where = {
      society_id: req.user.society_id,
      status: "ACTIVE",
    };

    if (req.user.role === "GUARD") {
      // Guard sees own alerts + any alert with no assigned on-shift guard
      where[Op.or] = [{ guard_id: req.user.id }, { guard_id: null }];
    }

    const alerts = await EmergencyAlert.findAll({
      where,
      include: [
        { model: User, as: "Resident", attributes: ["id", "name"] },
        { model: User, as: "Guard", attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    res.json(alerts);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const resolveEmergency = async (req, res) => {
  try {
    const { id } = req.params;

    const alert = await EmergencyAlert.findByPk(id);

    if (!alert) {
      return res.status(404).json({ message: "Emergency not found" });
    }

    if (alert.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    alert.status = "RESOLVED";
    alert.resolved_at = new Date();

    await alert.save();

    if (alert.resident_id) {
      const title = "Emergency Resolved ✅";
      const message = `Your emergency alert (${alert.type}) has been marked as resolved by security.`;

      const notification = await Notification.create({
        society_id: alert.society_id,
        receiver_user_id: alert.resident_id,
        title: title,
        message: message,
        type: "EMERGENCY",
        action_type: "VIEW_EMERGENCY",
        action_route: "/resident/emergency",
        is_read: false
      });

      if (global.io) {
        global.io
          .to(`user_${alert.resident_id}`)
          .emit("new_notification", notification);
      }

      const resident = await User.findByPk(alert.resident_id, { attributes: ['fcm_token'] });

      if (resident && resident.fcm_token) {
        sendPushNotification(
          resident.fcm_token,
          title,
          message,
          { route: "/resident/emergency", type: "EMERGENCY_RESOLVED", alertId: String(alert.id) }
        ).catch(err => console.error("Push Error:", err));
      }
    }

    res.json({ message: "Emergency resolved successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMyEmergencies = async (req, res) => {
  try {
    const user = req.user;
    const primaryId = await getPrimaryResidentId(user.id);

    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    const offset = (page - 1) * limit;

    const where = {
      society_id:  user.society_id,
      resident_id: primaryId,
    };

    if (status) where.status = status;

    const { count, rows } = await EmergencyAlert.findAndCountAll({
      where,
      include: [
        { model: User, as: "Resident", attributes: ["id", "name"] },
        { model: User, as: "Guard",    attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
      ],
      order:  [["created_at", "DESC"]],
      limit,
      offset,
    });

    res.json({
      data: rows,
      pagination: {
        currentPage:  page,
        totalPages:   Math.ceil(count / limit),
        totalItems:   count,
        hasNextPage:  page < Math.ceil(count / limit),
        hasPrevPage:  page > 1,
      },
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createEmergency,
  getEmergencyAlerts,
  resolveEmergency,
  getActiveEmergencies,
  getMyEmergencies
};
