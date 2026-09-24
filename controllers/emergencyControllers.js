

const EmergencyAlert = require("../models/EmergencyAlert");
const EmergencyAcknowledgement = require("../models/EmergencyAcknowledgement");
const GuardShift = require("../models/GuardShift");
const { User, Flat, Block, HouseHoldMember, Notification, Society, FlatMembership } = require("../models");
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");

const { getCurrentISTDate, getCurrentISTMinutes } = require("../utils/istTime");
const { getShiftTimings, isTimeInShift } = require("../utils/shiftTiming");

const getOnShiftGuardId = async (societyId) => {
  const today   = getCurrentISTDate();
  const timings = await getShiftTimings(societyId);
  const minutes = getCurrentISTMinutes();

  const shifts = await GuardShift.findAll({
    where: {
      society_id: societyId,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  const active = shifts.find((s) => isTimeInShift(timings, s.shift_type, minutes));
  return active ? active.guard_id : null;
};

const getFlatIdForUser = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.id;

  const currentMembership = await FlatMembership.findOne({ where: { user_id: userId, is_current: true } });
  if (currentMembership) return currentMembership.flat_id;

  const anyMembership = await FlatMembership.findOne({ where: { user_id: userId } });
  if (anyMembership) return anyMembership.flat_id;

  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) return member.flat_id;

  const user = await User.findByPk(userId);
  if (user && user.flat_id) return user.flat_id;

  return null;
};

const getPrimaryResidentId = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.resident_id;

  const currentMembership = await FlatMembership.findOne({ where: { user_id: userId, is_current: true } });
  if (currentMembership) {
    const f = await Flat.findByPk(currentMembership.flat_id);
    if (f && f.resident_id) return f.resident_id;
  }

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
    const isActive = (r) => String(activeRole) === r;
    let senderKind;
    if (isActive("SUPER_ADMIN")) senderKind = "SUPER_ADMIN";
    else if (isActive("GUARD")) senderKind = "GUARD";
    else if (isActive("RESIDENT")) senderKind = "RESIDENT";
    else if (isActive("FAMILY_MEMBER")) senderKind = "FAMILY_MEMBER";
    else if (isActive("SOCIETY_ADMIN") || isActive("ADMIN")) senderKind = "ADMIN";
    else if (isActive("COMMITTEE_MEMBER") || isActive("COMMITTEE")) senderKind = "COMMITTEE";
    else if (isActive("ACCOUNTANT")) senderKind = "ADMIN";
    else if (roles.includes("GUARD")) senderKind = "GUARD";
    else if (roles.includes("FAMILY_MEMBER")) senderKind = "FAMILY_MEMBER";
    else if (roles.includes("SOCIETY_ADMIN") || roles.includes("ADMIN")) senderKind = "ADMIN";
    else if (roles.includes("COMMITTEE_MEMBER") || roles.includes("COMMITTEE")) senderKind = "COMMITTEE";
    else if (roles.includes("ACCOUNTANT")) senderKind = "ADMIN";
    else if (roles.includes("RESIDENT")) senderKind = "RESIDENT";
    else senderKind = "RESIDENT";

    const payload = {
      type: req.body.type || "OTHER",
      message: req.body.message,
      other_reason: req.body.other_reason || null,
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

    // ✅ SOCIETY_ADMIN / ADMIN / ACCOUNTANT
    else if (senderKind === "ADMIN") {
      payload.admin_id = user.id;
      payload.source = "ADMIN";
      const flatId = req.body.flat_id || await getFlatIdForUser(user.id);
      if (flatId) payload.flat_id = flatId;
    }

    // ✅ COMMITTEE_MEMBER
    else if (senderKind === "COMMITTEE") {
      payload.admin_id = user.id;
      payload.source = "COMMITTEE";
      const flatId = req.body.flat_id || await getFlatIdForUser(user.id);
      if (flatId) payload.flat_id = flatId;
    }

    // ✅ RESIDENT (flat mandatory)
    else if (senderKind === "RESIDENT") {
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

    // Record sender acknowledgement automatically
    try {
      await EmergencyAcknowledgement.create({
        emergency_alert_id: emergency.id,
        user_id: user.id,
        viewed_at: new Date(),
        read_at: new Date(),
      });
    } catch (e) {
      console.log("Error creating initial sender acknowledgement:", e.message);
    }

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
      senderId: String(user.id),
      title: alertTitle,
      message: payload.message || alertBody,
      senderName: user.name || "Resident",
      flatNumber: senderFlatNumber,
      blockName: senderBlockName,
      alert_type: payload.type,
      other_reason: payload.other_reason || "",
    };

    // Gather ALL active users in the society to notify (excluding sender)
    const targetUsers = await User.findAll({
      where: {
        society_id: payload.society_id,
        status: "ACTIVE",
        id: { [Op.ne]: user.id }
      },
      attributes: ['id', 'name', 'role', 'roles', 'fcm_token']
    });

    for (const targetUser of targetUsers) {
      const uRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [targetUser.role];
      const isGuard = targetUser.role === "GUARD" || uRoles.includes("GUARD");
      const isCommitteeOrAdmin =
        targetUser.role === "COMMITTEE_MEMBER" ||
        targetUser.role === "SOCIETY_ADMIN" ||
        targetUser.role === "ADMIN" ||
        uRoles.includes("COMMITTEE_MEMBER") ||
        uRoles.includes("SOCIETY_ADMIN") ||
        uRoles.includes("ADMIN");

      let actionRoute = "/resident/emergency";
      let userAlertTitle = alertTitle;
      let userAlertBody = alertBody;

      if (isGuard) {
        actionRoute = "/guard/emergency";
        if (senderKind === "RESIDENT" || senderKind === "FAMILY_MEMBER") {
          userAlertBody = `🚨 Resident SOS Alert: ${payload.type} reported${flatInfoStr}. ${payload.message || ''}`;
        }
      } else if (isCommitteeOrAdmin) {
        actionRoute = "/admin/emergency";
        if (senderKind === "GUARD") {
          userAlertTitle = `🚨 GATE EMERGENCY: ${payload.type}`;
          userAlertBody = `🚨 Guard SOS Alert: ${payload.type} reported at Security Gate. ${payload.message || ''}`;
        } else if (senderKind === "RESIDENT" || senderKind === "FAMILY_MEMBER") {
          userAlertBody = `🚨 Resident SOS Alert: ${payload.type} reported${flatInfoStr}. ${payload.message || ''}`;
        }
      } else {
        actionRoute = "/resident/emergency";
        if (senderKind === "GUARD") {
          userAlertTitle = `🚨 GATE EMERGENCY: ${payload.type}`;
          userAlertBody = `🚨 Guard SOS Alert: ${payload.type} reported at Security Gate. ${payload.message || ''}`;
        } else if (senderKind === "ADMIN" || senderKind === "COMMITTEE" || senderKind === "SUPER_ADMIN") {
          userAlertBody = `🚨 Management SOS Alert: ${payload.type} reported by ${user.name}. ${payload.message || ''}`;
        } else {
          userAlertBody = `SOS Alert: ${payload.type} reported${flatInfoStr}. Please check if help is needed!`;
        }
      }

      try {
        const notification = await Notification.create({
          society_id: payload.society_id,
          receiver_user_id: targetUser.id,
          title: userAlertTitle,
          message: userAlertBody,
          type: "EMERGENCY",
          action_type: "VIEW_EMERGENCY",
          action_route: actionRoute,
          is_read: false
        });

        const notifData = {
          ...notification.toJSON(),
          ...emergencyPushData,
          title: userAlertTitle,
          message: userAlertBody,
          route: actionRoute,
          action_route: actionRoute,
          alertId: String(emergency.id),
        };

        if (global.io) {
          global.io.to(`user_${targetUser.id}`).emit("new_notification", notifData);
        }

        if (targetUser.fcm_token) {
          sendPushNotification(
            targetUser.fcm_token,
            userAlertTitle,
            userAlertBody,
            {
              ...emergencyPushData,
              title: userAlertTitle,
              message: userAlertBody,
              route: actionRoute,
              action_route: actionRoute,
            }
          ).catch(err => console.error("Push Error for user " + targetUser.id + ":", err));
        }
      } catch (err) {
        console.error("Failed to notify user " + targetUser.id + ":", err.message);
      }
    }

    // Broadcast general socket emergency event to society room
    if (global.io && payload.society_id) {
      global.io.to(`society_${payload.society_id}`).emit("emergency_alert", {
        ...emergencyPushData,
        alertId: String(emergency.id),
      });
    }

    res.status(201).json({
      ...emergency.toJSON(),
      shiftInfo: payload.guard_id
        ? `Alert routed to on-shift guard`
        : "⚠️ No guard on shift right now — alert visible to admins and neighbors",
    });

  } catch (error) {
    console.error("createEmergency error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getEmergencyAlerts = async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    const where = {};

    if (isSuperAdmin) {
      if (req.query.society_id) {
        where.society_id = parseInt(req.query.society_id, 10);
      }
    } else {
      where.society_id = req.user.society_id;
    }

    if (req.user.role === "GUARD" && !isSuperAdmin) {
      // Guard sees own alerts + any alert with no assigned on-shift guard
      where[Op.or] = [{ guard_id: req.user.id }, { guard_id: null }];
    }

    if (req.query.status && req.query.status !== "ALL") {
      where.status = req.query.status.toUpperCase();
    }

    if (req.query.type && req.query.type !== "ALL") {
      where.type = req.query.type;
    }

    if (req.query.startDate || req.query.endDate) {
      where.created_at = {};
      if (req.query.startDate) {
        where.created_at[Op.gte] = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = end;
      }
    }

    if (req.query.search && req.query.search.trim()) {
      const q = `%${req.query.search.trim()}%`;
      where[Op.or] = [
        { message: { [Op.like]: q } },
        { type: { [Op.like]: q } },
        { other_reason: { [Op.like]: q } },
        { "$Resident.name$": { [Op.like]: q } },
        { "$Flat.flat_number$": { [Op.like]: q } },
      ];
    }

    const alerts = await EmergencyAlert.findAll({
      where,
      include: [
        {
          model: User,
          as: "Resident",
          attributes: ["id", "name", "email", "phone"],
          include: [
            {
              model: FlatMembership,
              attributes: ["id", "flat_id", "is_current"],
              include: [
                {
                  model: Flat,
                  attributes: ["id", "flat_number"],
                  include: [{ model: Block, attributes: ["id", "name"] }],
                },
              ],
            },
          ],
        },
        { model: User, as: "Guard", attributes: ["id", "name", "phone"] },
        { model: User, as: "Admin", attributes: ["id", "name", "email", "phone"] },
        { model: User, as: "Resolver", attributes: ["id", "name", "email", "phone"] },
        { model: Society, attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
        {
          model: EmergencyAcknowledgement,
          as: "acknowledgements",
          attributes: ["id", "user_id", "read_at", "viewed_at"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const populatedAlerts = alerts.map((alert) => {
      const plain = alert.toJSON();
      if (!plain.Flat && plain.Resident?.FlatMemberships?.length) {
        const primary = plain.Resident.FlatMemberships.find((m) => m.is_current) || plain.Resident.FlatMemberships[0];
        if (primary && primary.Flat) {
          plain.Flat = primary.Flat;
        }
      }
      return plain;
    });

    res.json(populatedAlerts);

  } catch (err) {
    console.error("getEmergencyAlerts error:", err);
    res.status(500).json({ message: err.message });
  }
};

const getEmergencyById = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await EmergencyAlert.findByPk(id, {
      include: [
        { model: User, as: "Resident", attributes: ["id", "name", "email", "phone"] },
        { model: User, as: "Guard", attributes: ["id", "name", "phone"] },
        { model: User, as: "Admin", attributes: ["id", "name", "email", "phone"] },
        { model: User, as: "Resolver", attributes: ["id", "name", "email", "phone"] },
        { model: Society, attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
        {
          model: EmergencyAcknowledgement,
          as: "acknowledgements",
          attributes: ["id", "user_id", "read_at", "viewed_at"],
        },
      ],
    });

    if (!alert) return res.status(404).json({ message: "Emergency alert not found" });

    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    if (!isSuperAdmin && alert.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Unauthorized access to alert" });
    }

    res.json(alert);
  } catch (err) {
    console.error("getEmergencyById error:", err);
    res.status(500).json({ message: err.message });
  }
};

const getEmergencyAcknowledgements = async (req, res) => {
  try {
    const { id } = req.params;
    const { search, status } = req.query;

    const alert = await EmergencyAlert.findByPk(id, {
      include: [
        { model: Flat, attributes: ["id", "flat_number"], include: [{ model: Block, attributes: ["id", "name"] }] },
        { model: User, as: "Resident", attributes: ["id", "name", "email", "phone"] },
      ],
    });
    if (!alert) return res.status(404).json({ message: "Emergency alert not found" });

    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    if (!isSuperAdmin && String(alert.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied: Alert belongs to another society" });
    }

    const recipientsWhere = {
      society_id: alert.society_id,
      status: "ACTIVE",
      role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER", "COMMITTEE_MEMBER", "SOCIETY_ADMIN", "GUARD"] },
    };

    if (search && search.trim()) {
      recipientsWhere[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { email: { [Op.like]: `%${search.trim()}%` } },
      ];
    }

    const recipients = await User.findAll({
      where: recipientsWhere,
      attributes: ["id", "name", "email", "phone", "role"],
      order: [["name", "ASC"]],
    });

    const recipientIds = recipients.map((r) => r.id);

    const memberships = recipientIds.length > 0
      ? await FlatMembership.findAll({
          where: { user_id: { [Op.in]: recipientIds }, is_current: true },
          include: [{ model: Flat, attributes: ["flat_number"], include: [{ model: Block, attributes: ["name"] }] }],
        })
      : [];

    const flatMap = {};
    const blockMap = {};
    memberships.forEach((m) => {
      if (m.Flat?.flat_number) {
        flatMap[m.user_id] = m.Flat.flat_number;
        blockMap[m.user_id] = m.Flat.Block?.name || "";
      }
    });

    // Fallback lookup on Flat table
    const primaryFlats = recipientIds.length > 0
      ? await Flat.findAll({
          where: { resident_id: { [Op.in]: recipientIds } },
          include: [{ model: Block, attributes: ["name"] }],
        })
      : [];
    primaryFlats.forEach((f) => {
      if (!flatMap[f.resident_id]) {
        flatMap[f.resident_id] = f.flat_number;
        blockMap[f.resident_id] = f.Block?.name || "";
      }
    });

    const acks = recipientIds.length > 0
      ? await EmergencyAcknowledgement.findAll({
          where: { emergency_alert_id: id, user_id: { [Op.in]: recipientIds } },
        })
      : [];
    const ackMap = Object.fromEntries(acks.map((a) => [a.user_id, a]));

    const notifs = recipientIds.length > 0
      ? await Notification.findAll({
          where: {
            society_id: alert.society_id,
            receiver_user_id: { [Op.in]: recipientIds },
            type: "EMERGENCY",
            is_read: true,
          },
        })
      : [];
    const notifReadMap = new Set(notifs.map((n) => n.receiver_user_id));

    let readCount = 0;
    let unreadCount = 0;

    let userList = recipients.map((r) => {
      const ack = ackMap[r.id];
      const isRead = Boolean(ack?.read_at || ack?.acknowledged_at || notifReadMap.has(r.id) || r.id === alert.resident_id || r.id === alert.guard_id || r.id === alert.admin_id);

      if (isRead) {
        readCount++;
      } else {
        unreadCount++;
      }

      return {
        user_id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        role: r.role,
        flat_number: flatMap[r.id] || "—",
        block_name: blockMap[r.id] || "",
        viewed_at: ack?.viewed_at || (isRead ? ack?.read_at || ack?.updated_at || alert.created_at : null),
        read_at: ack?.read_at || (isRead ? ack?.updated_at || alert.created_at : null),
        status: isRead ? "READ" : "UNREAD",
      };
    });

    if (status && status !== "ALL") {
      if (status === "READ") {
        userList = userList.filter((u) => u.status === "READ");
      } else if (status === "UNREAD") {
        userList = userList.filter((u) => u.status === "UNREAD");
      }
    }

    res.json({
      summary: {
        total: recipients.length,
        read: readCount,
        unread: unreadCount,
      },
      recipients: userList,
      alert: {
        id: alert.id,
        type: alert.type,
        message: alert.message,
        other_reason: alert.other_reason,
        created_at: alert.created_at,
        status: alert.status,
      },
    });
  } catch (err) {
    console.error("getEmergencyAcknowledgements error:", err);
    res.status(500).json({ message: err.message });
  }
};

const markEmergencyAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const alert = await EmergencyAlert.findByPk(id);
    if (!alert) return res.status(404).json({ message: "Emergency alert not found" });

    const [ack, created] = await EmergencyAcknowledgement.findOrCreate({
      where: { emergency_alert_id: id, user_id: userId },
      defaults: {
        emergency_alert_id: id,
        user_id: userId,
        viewed_at: new Date(),
        read_at: new Date(),
      },
    });

    if (!created && !ack.read_at) {
      ack.read_at = new Date();
      if (!ack.viewed_at) ack.viewed_at = new Date();
      await ack.save();
    }

    // Mark matching notifications as read
    await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_user_id: userId,
          type: "EMERGENCY",
        },
      }
    );

    if (global.io) {
      global.io.to(`user_${userId}`).emit("emergency_acknowledged", {
        emergency_alert_id: id,
        user_id: userId,
        read_at: ack.read_at,
      });
    }

    res.json({ success: true, message: "Emergency alert marked as read", ack });
  } catch (err) {
    console.error("markEmergencyAsRead error:", err);
    res.status(500).json({ message: err.message });
  }
};

const getActiveEmergencies = async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    const where = {
      status: "ACTIVE",
    };

    if (isSuperAdmin) {
      if (req.query.society_id) {
        where.society_id = parseInt(req.query.society_id, 10);
      }
    } else {
      where.society_id = req.user.society_id;
    }

    if (req.user.role === "GUARD" && !isSuperAdmin) {
      where[Op.or] = [{ guard_id: req.user.id }, { guard_id: null }];
    }

    const alerts = await EmergencyAlert.findAll({
      where,
      include: [
        { model: User, as: "Resident", attributes: ["id", "name"] },
        { model: User, as: "Guard", attributes: ["id", "name"] },
        { model: User, as: "Admin", attributes: ["id", "name"] },
        { model: User, as: "Resolver", attributes: ["id", "name"] },
        { model: Society, attributes: ["id", "name"] },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [{ model: Block, attributes: ["id", "name"] }],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const liveAlerts = alerts.filter((a) => {
      const msg = String(a.message || "").toLowerCase();
      return !msg.includes("automated test");
    });

    res.json(liveAlerts);

  } catch (err) {
    console.error("getActiveEmergencies error:", err);
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

    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    if (!isSuperAdmin && alert.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    alert.status = "RESOLVED";
    alert.resolved_at = new Date();
    alert.resolved_by = req.user.id;
    const { resolution_notes } = req.body || {};
    if (resolution_notes) {
      alert.resolution_notes = resolution_notes;
    }

    await alert.save();

    if (alert.resident_id) {
      const title = "Emergency Resolved ✅";
      const message = `Your emergency alert (${alert.type}) has been marked as resolved.`;

      const notification = await Notification.create({
        society_id: alert.society_id,
        receiver_user_id: alert.resident_id,
        title: title,
        message: message,
        type: "EMERGENCY_RESOLVED",
        action_type: "VIEW_EMERGENCY",
        action_route: "/resident/emergency",
        is_read: false
      });

      if (global.io) {
        global.io
          .to(`user_${alert.resident_id}`)
          .emit("new_notification", {
            ...notification.toJSON(),
            alertId: String(alert.id),
          });
        global.io
          .to(`society_${alert.society_id}`)
          .emit("emergency_resolved", { id: alert.id, alertId: String(alert.id), status: "RESOLVED" });
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
    } else if (global.io) {
      global.io
        .to(`society_${alert.society_id}`)
        .emit("emergency_resolved", { id: alert.id, status: "RESOLVED" });
    }

    res.json({ success: true, message: "Emergency resolved successfully", alert });

  } catch (err) {
    console.error("resolveEmergency error:", err);
    res.status(500).json({ message: err.message });
  }
};

const updateEmergency = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await EmergencyAlert.findByPk(id);
    if (!alert) return res.status(404).json({ message: "Emergency alert not found" });

    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    if (!isSuperAdmin && alert.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Unauthorized to edit this emergency" });
    }

    if (req.body.message !== undefined) alert.message = req.body.message;
    if (req.body.type !== undefined) alert.type = req.body.type;
    if (req.body.other_reason !== undefined) alert.other_reason = req.body.other_reason;
    if (req.body.resolution_notes !== undefined) alert.resolution_notes = req.body.resolution_notes;
    if (req.body.status !== undefined && ["ACTIVE", "RESOLVED"].includes(req.body.status)) {
      alert.status = req.body.status;
      if (req.body.status === "RESOLVED" && !alert.resolved_at) {
        alert.resolved_at = new Date();
        alert.resolved_by = req.user.id;
      }
    }

    await alert.save();

    res.json({ success: true, message: "Emergency alert updated successfully", alert });
  } catch (err) {
    console.error("updateEmergency error:", err);
    res.status(500).json({ message: err.message });
  }
};

const deleteEmergency = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await EmergencyAlert.findByPk(id);
    if (!alert) return res.status(404).json({ message: "Emergency alert not found" });

    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    if (!isSuperAdmin && alert.society_id !== req.user.society_id) {
      return res.status(403).json({ message: "Unauthorized to delete this emergency" });
    }

    await EmergencyAcknowledgement.destroy({ where: { emergency_alert_id: id } });
    await alert.destroy();

    res.json({ success: true, message: "Emergency alert deleted successfully" });
  } catch (err) {
    console.error("deleteEmergency error:", err);
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

    if (status && status !== "ALL") where.status = status;

    const { count, rows } = await EmergencyAlert.findAndCountAll({
      where,
      include: [
        { model: User, as: "Resident", attributes: ["id", "name"] },
        { model: User, as: "Guard",    attributes: ["id", "name"] },
        { model: User, as: "Admin",    attributes: ["id", "name"] },
        { model: User, as: "Resolver", attributes: ["id", "name"] },
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
    console.error("getMyEmergencies error:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createEmergency,
  getEmergencyAlerts,
  getEmergencyById,
  getEmergencyAcknowledgements,
  markEmergencyAsRead,
  resolveEmergency,
  updateEmergency,
  deleteEmergency,
  getActiveEmergencies,
  getMyEmergencies
};
