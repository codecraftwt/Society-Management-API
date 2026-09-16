

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
    const activeRole = user.activeRole;

    // Decide sender kind — active role wins over stacked roles
    // (e.g. an admin who is also a resident raises as ADMIN from the admin panel)
    const isActive = (r) => String(activeRole) === r;
    let senderKind;
    if (isActive("SUPER_ADMIN")) senderKind = "SUPER_ADMIN";
    else if (isActive("GUARD")) senderKind = "GUARD";
    else if (isActive("RESIDENT")) senderKind = "RESIDENT";
    else if (isActive("FAMILY_MEMBER")) senderKind = "FAMILY_MEMBER";
    else if (isActive("SOCIETY_ADMIN") || isActive("ADMIN")) senderKind = "ADMIN";
    else if (isActive("COMMITTEE_MEMBER") || isActive("COMMITTEE")) senderKind = "COMMITTEE";
    else if (roles.includes("GUARD")) senderKind = "GUARD";
    else if (roles.includes("FAMILY_MEMBER")) senderKind = "FAMILY_MEMBER";
    else if (roles.includes("SOCIETY_ADMIN") || roles.includes("ADMIN")) senderKind = "ADMIN";
    else if (roles.includes("COMMITTEE_MEMBER") || roles.includes("COMMITTEE")) senderKind = "COMMITTEE";
    else if (roles.includes("RESIDENT")) senderKind = "RESIDENT";
    else senderKind = "RESIDENT";

    const payload = {
      type: req.body.type || "OTHER",
      message: req.body.message,
      society_id: user.society_id,
      status: "ACTIVE",
    };

    let flatInfoStr = "";

    if (senderKind === "GUARD") {
      payload.guard_id = user.id;
      payload.source = "GUARD";
    }

    // ✅ SUPER_ADMIN — target society is chosen in the app (not bound to a profile society)
    else if (senderKind === "SUPER_ADMIN") {
      const societyId = parseInt(req.body.society_id, 10);
      if (!societyId) {
        return res.status(400).json({
          message: "Super Admin must select a target society for the SOS alert"
        });
      }
      payload.society_id = societyId;
      payload.admin_id = user.id;
      payload.source = "SUPER_ADMIN";
    }

    // ✅ SOCIETY_ADMIN / ADMIN
    else if (senderKind === "ADMIN") {
      payload.admin_id = user.id;
      payload.source = "ADMIN";
    }

    // ✅ COMMITTEE_MEMBER
    else if (senderKind === "COMMITTEE") {
      payload.admin_id = user.id;
      payload.source = "COMMITTEE";
    }

    // ✅ RESIDENT (flat mandatory)
    else if (senderKind === "RESIDENT") {

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
    else if (senderKind === "FAMILY_MEMBER") {

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

    // ✅ ADMIN / COMMITTEE / SUPER_ADMIN — route to the on-shift guard too
    if (["ADMIN", "COMMITTEE", "SUPER_ADMIN"].includes(senderKind)) {
      const onShiftGuardId = await getOnShiftGuardId(payload.society_id);
      if (onShiftGuardId) payload.guard_id = onShiftGuardId;
    }

    const emergency = await EmergencyAlert.create(payload);

    const alertTitle = `🚨 EMERGENCY: ${payload.type} 🚨`;
    const alertBody = `New emergency alert raised${flatInfoStr}: ${payload.message}`;

    let senderFlatNumber = "";
    let senderBlockName = "";
    if (payload.flat_id) {
      const f = await Flat.findByPk(payload.flat_id, {
        include: [{ model: Block, attributes: ["name"] }]
      });
      if (f) {
        senderFlatNumber = f.flat_number || "";
        senderBlockName = f.Block?.name || "";
      }
    }

    const emergencyPushData = {
      type: "EMERGENCY",
      alertId: String(emergency.id),
      title: alertTitle,
      message: payload.message || alertBody,
      senderName: user.name || "Resident",
      flatNumber: senderFlatNumber,
      blockName: senderBlockName,
      alert_type: payload.type,
    };

    // 1. Notify Guard
    if ((senderKind === "RESIDENT" || senderKind === "FAMILY_MEMBER") && payload.guard_id) {

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

      const notifData = {
        ...notification.toJSON(),
        ...emergencyPushData,
        alertId: String(emergency.id),
      };

      if (global.io) {
        global.io
          .to(`user_${payload.guard_id}`)
          .emit("new_notification", notifData);
      }

      const guardUser = await User.findByPk(payload.guard_id, { attributes: ['fcm_token'] });

      if (guardUser && guardUser.fcm_token) {
        sendPushNotification(
          guardUser.fcm_token,
          alertTitle,
          alertBody,
          { ...emergencyPushData, route: "/guard/emergency" }
        ).catch(err => console.error("Push Error:", err));
      }
    }

    // 2. Notify Admins & Committee Members
    const adminRoles = ["SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ADMIN"];
    const admins = await User.findAll({
      where: {
        society_id: payload.society_id,
        role: { [Op.in]: adminRoles },
        id: { [Op.ne]: user.id }
      },
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

      const notifData = {
        ...notification.toJSON(),
        ...emergencyPushData,
        alertId: String(emergency.id),
      };

      if (global.io) {
        global.io
          .to(`user_${admin.id}`)
          .emit("new_notification", notifData);
      }

      if (admin.fcm_token) {
        sendPushNotification(
          admin.fcm_token,
          alertTitle,
          alertBody,
          { ...emergencyPushData, route: "/admin/emergency" }
        ).catch(err => console.error("Push Error:", err));
      }
    }

    // 3. Notify Residents / Family Members
    const isResidentKind = senderKind === "RESIDENT" || senderKind === "FAMILY_MEMBER";
    const isAdminKind = ["ADMIN", "COMMITTEE", "SUPER_ADMIN"].includes(senderKind);

    if (isResidentKind) {
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

        const notifData = {
          ...notification.toJSON(),
          ...emergencyPushData,
          message: neighborBody,
          alertId: String(emergency.id),
        };

        if (global.io) {
          global.io.to(`user_${neighbor.id}`).emit("new_notification", notifData);
        }

        if (neighbor.fcm_token) {
          sendPushNotification(
            neighbor.fcm_token,
            alertTitle,
            neighborBody,
            { ...emergencyPushData, message: neighborBody, route: "/resident/emergency" }
          ).catch(err => console.error("Push Error:", err));
        }
      }
    }

    // Guard / Admin / Committee / Super Admin raised emergency: broadcast to all residents in the society
    if (senderKind === "GUARD" || isAdminKind) {
      const residents = await User.findAll({
        where: {
          society_id: payload.society_id,
          role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER"] },
        },
        attributes: ['id', 'fcm_token']
      });

      let broadcastTitle;
      let broadcastBody;
      if (senderKind === "GUARD") {
        broadcastTitle = `🚨 GATE EMERGENCY: ${payload.type}`;
        broadcastBody = `🚨 Guard SOS Alert: ${payload.type} reported at Security Gate. ${payload.message || ''}`;
      } else if (senderKind === "ADMIN") {
        broadcastTitle = `🚨 SOS ALERT: ${payload.type}`;
        broadcastBody = `🚨 Admin SOS Alert: ${payload.type} reported by ${user.name}. ${payload.message || ''}`;
      } else if (senderKind === "COMMITTEE") {
        broadcastTitle = `🚨 SOS ALERT: ${payload.type}`;
        broadcastBody = `🚨 Committee SOS Alert: ${payload.type} reported by ${user.name}. ${payload.message || ''}`;
      } else {
        broadcastTitle = `🚨 SOS ALERT: ${payload.type}`;
        broadcastBody = `🚨 Super Admin SOS Alert: ${payload.type} reported by ${user.name}. ${payload.message || ''}`;
      }

      for (const resUser of residents) {
        const notification = await Notification.create({
          society_id: payload.society_id,
          receiver_user_id: resUser.id,
          title: broadcastTitle,
          message: broadcastBody,
          type: "EMERGENCY",
          action_type: "VIEW_EMERGENCY",
          action_route: "/resident/emergency",
          is_read: false
        });

        const notifData = {
          ...notification.toJSON(),
          ...emergencyPushData,
          senderName: user.name || "Security Guard",
          flatNumber: senderKind === "GUARD" ? "Security Gate" : "",
          blockName: senderKind === "GUARD" ? "Main Gate" : "",
          message: broadcastBody,
          alertId: String(emergency.id),
        };

        if (global.io) {
          global.io.to(`user_${resUser.id}`).emit("new_notification", notifData);
        }

        if (resUser.fcm_token) {
          sendPushNotification(
            resUser.fcm_token,
            broadcastTitle,
            broadcastBody,
            {
              ...emergencyPushData,
              senderName: user.name || "Security Guard",
              flatNumber: senderKind === "GUARD" ? "Security Gate" : "",
              blockName: senderKind === "GUARD" ? "Main Gate" : "",
              message: broadcastBody,
              route: "/resident/emergency"
            }
          ).catch(err => console.error("Push Error:", err));
        }
      }
    }

    // 4. Admin / Committee / Super Admin SOS: also alert every guard in the society
    if (isAdminKind) {
      const guards = await User.findAll({
        where: {
          society_id: payload.society_id,
          role: "GUARD",
          id: { [Op.ne]: user.id }
        },
        attributes: ['id', 'fcm_token']
      });

      const guardTitle = `🚨 SOS ALERT: ${payload.type}`;
      const guardBody = `🚨 ${senderKind === "SUPER_ADMIN" ? "Super Admin" : senderKind === "COMMITTEE" ? "Committee" : "Admin"} SOS Alert: ${payload.type} reported by ${user.name}. ${payload.message || ''}`;

      for (const guard of guards) {
        const notification = await Notification.create({
          society_id: payload.society_id,
          receiver_user_id: guard.id,
          title: guardTitle,
          message: guardBody,
          type: "EMERGENCY",
          action_type: "VIEW_EMERGENCY",
          action_route: "/guard/emergency",
          is_read: false
        });

        const notifData = {
          ...notification.toJSON(),
          ...emergencyPushData,
          message: guardBody,
          alertId: String(emergency.id),
        };

        if (global.io) {
          global.io.to(`user_${guard.id}`).emit("new_notification", notifData);
        }

        if (guard.fcm_token) {
          sendPushNotification(
            guard.fcm_token,
            guardTitle,
            guardBody,
            { ...emergencyPushData, message: guardBody, route: "/guard/emergency" }
          ).catch(err => console.error("Push Error:", err));
        }
      }
    }

    // 5. Broadcast general socket emergency event to society room
    if (global.io && payload.society_id) {
      global.io.to(`society_${payload.society_id}`).emit("emergency_alert", {
        ...emergencyPushData,
        alertId: String(emergency.id),
      });
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
        { model: User, as: "Admin", attributes: ["id", "name"] },
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
        { model: User, as: "Admin", attributes: ["id", "name"] },
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

    if (req.user.role !== "SUPER_ADMIN" && alert.society_id !== req.user.society_id) {
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
        { model: User, as: "Admin",    attributes: ["id", "name"] },
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
