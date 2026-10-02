const Notice = require("../models/Notice");
const NoticeAcknowledgement = require("../models/NoticeAcknowledgement");
const Notification = require("../models/Notification");
const User = require("../models/User");
const UserSetting = require("../models/UserSetting");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const FlatMembership = require("../models/FlatMembership");
const AccountantAssignment = require("../models/AccountantAssignment");
const { sendPushNotification } = require("../utils/pushNotification");
const { Op } = require("sequelize");
const {
  getUserAuthorizedFlatIds,
  getFlatAuthorizedUserIds,
  isUserAuthorizedForFlat,
} = require("../utils/accessHelpers");

/* ════════════════════════════════════════
   CREATE NOTICE
════════════════════════════════════════ */
const createNotice = async (req, res) => {
  try {
    const {
      title,
      description,
      acknowledgement_required,
      society_id,
      target_type,
      target_flat_id,
    } = req.body;

    let fileUrl = null;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    const isAckRequired =
      acknowledgement_required === true || acknowledgement_required === "true";

    const targetSocietyId = society_id
      ? parseInt(society_id, 10)
      : req.headers["x-society-id"]
      ? parseInt(req.headers["x-society-id"], 10)
      : req.user.society_id;

    if (!targetSocietyId || isNaN(targetSocietyId)) {
      return res
        .status(400)
        .json({ message: "Please select a valid society to publish this notice." });
    }

    // Audience targeting validation
    let finalTargetType = "SOCIETY";
    let finalTargetFlatId = null;

    if (target_type === "FLAT") {
      if (!target_flat_id) {
        return res
          .status(400)
          .json({ message: "A specific flat must be selected for flat-targeted notices." });
      }

      const flatIdNum = parseInt(target_flat_id, 10);
      const verifiedFlat = await Flat.findOne({
        where: { id: flatIdNum },
        include: [
          {
            model: Block,
            where: { society_id: targetSocietyId },
            required: true,
          },
        ],
      });

      if (!verifiedFlat) {
        return res.status(400).json({
          message: "The selected flat does not belong to the chosen society.",
        });
      }

      finalTargetType = "FLAT";
      finalTargetFlatId = flatIdNum;
    }

    const callerRole = req.user.activeRole || req.user.role;
    const notice = await Notice.create({
      title,
      description,
      society_id: targetSocietyId,
      file_url: fileUrl,
      acknowledgement_required: isAckRequired,
      target_type: finalTargetType,
      target_flat_id: finalTargetFlatId,
      created_by_user_id: req.user.id,
      created_by_name:
        req.user.name ||
        (callerRole === "COMMITTEE_MEMBER" ? "Committee Member" : "Society Admin"),
      created_by_role: callerRole,
    });

    const fullNotice = await Notice.findByPk(notice.id, {
      include: [
        {
          model: Flat,
          as: "targetFlat",
          attributes: ["id", "flat_number"],
          include: [
            {
              model: Floor,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, attributes: ["id", "name"] }],
            },
          ],
        },
      ],
    });

    // ── Targeted Notifications & Socket.IO ──
    if (finalTargetType === "FLAT") {
      // 1. Resolve authorized users of this specific flat
      const targetUserIds = await getFlatAuthorizedUserIds(
        finalTargetFlatId,
        targetSocietyId
      );
      const recipientUserIds = targetUserIds.filter((id) => id !== req.user.id);

      // Emit to targeted user rooms only
      if (global.io) {
        for (const uid of targetUserIds) {
          global.io.to(`user_${uid}`).emit("notice_created", fullNotice || notice);
        }
        // Also emit to society admin room so admins see it on their panel
        global.io
          .to(`society_${targetSocietyId}_admins`)
          .emit("notice_created", fullNotice || notice);
      }

      if (recipientUserIds.length > 0) {
        const recipients = await User.findAll({
          where: {
            id: { [Op.in]: recipientUserIds },
            status: "ACTIVE",
          },
          attributes: ["id", "fcm_token"],
        });

        const allSettings = await UserSetting.findAll({
          where: { user_id: recipientUserIds },
          attributes: ["user_id", "notice_updates"],
        });
        const settingsMap = Object.fromEntries(
          allSettings.map((s) => [s.user_id, s])
        );

        for (const recipient of recipients) {
          const settings = settingsMap[recipient.id];
          if (!settings || settings.notice_updates === true) {
            const notification = await Notification.create({
              title: "Flat Notice",
              message: `📢 Notice for your flat: "${title}"`,
              type: "NOTICE",
              action_type: "VIEW_NOTICE",
              action_route: "/resident/notices",
              society_id: targetSocietyId,
              user_id: req.user.id,
              receiver_role: "RESIDENT",
              receiver_user_id: recipient.id,
            });

            if (global.io) {
              global.io
                .to(`user_${recipient.id}`)
                .emit("new_notification", notification);
            }

            if (recipient.fcm_token) {
              sendPushNotification(
                recipient.fcm_token,
                "Flat Notice",
                `📢 Notice for your flat: "${title}"`,
                {
                  route: "/resident/notices",
                  type: "NOTICE",
                  noticeId: notice.id.toString(),
                }
              ).catch((err) => console.error("Push Error:", err));
            }
          }
        }
      }
    } else {
      // Society-wide notice: broadcast to society room
      if (global.io) {
        global.io
          .to(`society_${targetSocietyId}`)
          .emit("notice_created", fullNotice || notice);
      }

      // Fetch all eligible society residents
      const residents = await User.findAll({
        where: {
          society_id: targetSocietyId,
          role: {
            [Op.in]: [
              "RESIDENT",
              "FAMILY_MEMBER",
              "COMMITTEE_MEMBER",
              "SOCIETY_ADMIN",
            ],
          },
          status: "ACTIVE",
          id: { [Op.ne]: req.user.id }, // never notify the sender
        },
        attributes: ["id", "fcm_token"],
      });

      const residentIds = residents.map((r) => r.id);
      const allSettings = await UserSetting.findAll({
        where: { user_id: residentIds },
        attributes: ["user_id", "notice_updates"],
      });
      const settingsMap = Object.fromEntries(
        allSettings.map((s) => [s.user_id, s])
      );

      for (const resident of residents) {
        const settings = settingsMap[resident.id];

        if (!settings || settings.notice_updates === true) {
          const notification = await Notification.create({
            title: "Society Notice",
            message: `📢 New notice posted: "${title}"`,
            type: "NOTICE",
            action_type: "VIEW_NOTICE",
            action_route: "/resident/notices",
            society_id: targetSocietyId,
            user_id: req.user.id,
            receiver_role: "RESIDENT",
            receiver_user_id: resident.id,
          });

          if (global.io) {
            global.io
              .to(`user_${resident.id}`)
              .emit("new_notification", notification);
          }

          if (resident.fcm_token) {
            sendPushNotification(
              resident.fcm_token,
              "New Society Notice",
              `📢 "${title}" has been posted.`,
              {
                route: "/resident/notices",
                type: "NOTICE",
                noticeId: notice.id.toString(),
              }
            ).catch((err) => console.error("Push Error:", err));
          }
        }
      }
    }

    res.status(200).json(fullNotice || notice);
  } catch (err) {
    console.error("Create Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ════════════════════════════════════════
   UPDATE NOTICE
════════════════════════════════════════ */
const updateNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      acknowledgement_required,
      target_type,
      target_flat_id,
    } = req.body;

    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (
      req.user.role !== "SUPER_ADMIN" &&
      String(notice.society_id) !== String(req.user.society_id)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    if (callerRole === "COMMITTEE_MEMBER") {
      const isCreatedByAdmin =
        notice.created_by_role === "SOCIETY_ADMIN" ||
        notice.created_by_role === "SUPER_ADMIN" ||
        !notice.created_by_role;
      const isDifferentUser =
        notice.created_by_user_id &&
        Number(notice.created_by_user_id) !== Number(req.user.id);
      if (isCreatedByAdmin || isDifferentUser) {
        return res.status(403).json({
          message: "Committee members cannot modify Admin-created notices",
        });
      }
    }

    let fileUrl = notice.file_url;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    let isAckRequired = notice.acknowledgement_required;
    if (acknowledgement_required !== undefined) {
      isAckRequired =
        acknowledgement_required === true || acknowledgement_required === "true";
    }

    let finalTargetType = notice.target_type || "SOCIETY";
    let finalTargetFlatId = notice.target_flat_id || null;

    if (target_type !== undefined) {
      if (target_type === "FLAT") {
        const flatIdNum = parseInt(target_flat_id || notice.target_flat_id, 10);
        if (!flatIdNum) {
          return res.status(400).json({
            message: "A specific flat must be selected for flat-targeted notices.",
          });
        }

        const verifiedFlat = await Flat.findOne({
          where: { id: flatIdNum },
          include: [
            {
              model: Block,
              where: { society_id: notice.society_id },
              required: true,
            },
          ],
        });

        if (!verifiedFlat) {
          return res.status(400).json({
            message: "The selected flat does not belong to the notice's society.",
          });
        }

        finalTargetType = "FLAT";
        finalTargetFlatId = flatIdNum;
      } else {
        finalTargetType = "SOCIETY";
        finalTargetFlatId = null;
      }
    }

    await notice.update({
      title: title || notice.title,
      description: description || notice.description,
      file_url: fileUrl,
      acknowledgement_required: isAckRequired,
      target_type: finalTargetType,
      target_flat_id: finalTargetFlatId,
    });

    const updatedNotice = await Notice.findByPk(notice.id, {
      include: [
        {
          model: Flat,
          as: "targetFlat",
          attributes: ["id", "flat_number"],
          include: [
            {
              model: Floor,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, attributes: ["id", "name"] }],
            },
          ],
        },
      ],
    });

    res.status(200).json(updatedNotice || notice);
  } catch (err) {
    console.error("Update Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   DELETE NOTICE
════════════════════════════════════════ */
const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (
      req.user.role !== "SUPER_ADMIN" &&
      String(notice.society_id) !== String(req.user.society_id)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    if (callerRole === "COMMITTEE_MEMBER") {
      const isCreatedByAdmin =
        notice.created_by_role === "SOCIETY_ADMIN" ||
        notice.created_by_role === "SUPER_ADMIN" ||
        !notice.created_by_role;
      const isDifferentUser =
        notice.created_by_user_id &&
        Number(notice.created_by_user_id) !== Number(req.user.id);
      if (isCreatedByAdmin || isDifferentUser) {
        return res.status(403).json({
          message: "Committee members cannot delete Admin-created notices",
        });
      }
    }

    await NoticeAcknowledgement.destroy({ where: { notice_id: id } });
    await notice.destroy();
    res.status(200).json({ message: "Notice deleted successfully" });
  } catch (err) {
    console.error("Delete Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   GET NOTICES  (paginated + search + ack state + audience filter)
════════════════════════════════════════ */
const getNotices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search = (req.query.search || req.query.q || "").trim();
    const targetSocId =
      req.headers["x-society-id"] ||
      req.query.society_id ||
      req.user.society_id;

    const callerRole = req.user.activeRole || req.user.role;
    const isAdminOrStaff = [
      "SUPER_ADMIN",
      "SOCIETY_ADMIN",
      "COMMITTEE_MEMBER",
      "ACCOUNTANT",
    ].includes(callerRole);

    const andConditions = [];
    if (targetSocId) {
      andConditions.push({ society_id: targetSocId });
    }

    // ── Audience Scoping for Residents / Family Members ──
    if (!isAdminOrStaff) {
      const authorizedFlatIds = await getUserAuthorizedFlatIds(
        req.user.id,
        targetSocId
      );

      const audienceOr = [
        { target_type: "SOCIETY" },
        { target_type: null },
      ];

      if (authorizedFlatIds.length > 0) {
        audienceOr.push({
          target_type: "FLAT",
          target_flat_id: { [Op.in]: authorizedFlatIds },
        });
      }

      andConditions.push({ [Op.or]: audienceOr });
    }

    if (search) {
      andConditions.push({
        [Op.or]: [
          { title: { [Op.like]: `%${search}%` } },
          { description: { [Op.like]: `%${search}%` } },
        ],
      });
    }

    const where = andConditions.length > 0 ? { [Op.and]: andConditions } : {};

    const { count, rows: notices } = await Notice.findAndCountAll({
      where,
      include: [
        {
          model: Flat,
          as: "targetFlat",
          attributes: ["id", "flat_number"],
          include: [
            {
              model: Floor,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, attributes: ["id", "name"] }],
            },
          ],
        },
      ],
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const totalAll = search
      ? await Notice.count({
          where:
            andConditions.filter((c) => !c[Op.or] || c[Op.or][0]?.title === undefined).length > 0
              ? {
                  [Op.and]: andConditions.filter(
                    (c) => !c[Op.or] || c[Op.or][0]?.title === undefined
                  ),
                }
              : {},
        })
      : count;

    // Attach acknowledgement status for logged-in user
    const noticeIds = notices.map((n) => n.id);
    const acks =
      noticeIds.length > 0
        ? await NoticeAcknowledgement.findAll({
            where: { notice_id: noticeIds, user_id: req.user.id },
          })
        : [];
    const ackMap = Object.fromEntries(acks.map((a) => [a.notice_id, a]));

    const decoratedNotices = notices.map((n) => {
      const noticeJson = n.toJSON();
      const ack = ackMap[n.id];

      let status = "NOT_REQUIRED";
      if (n.acknowledgement_required) {
        if (!ack || !ack.viewed_at) {
          status = "NOT_VIEWED";
        } else if (!ack.acknowledged_at) {
          status = "VIEWED_NOT_ACKNOWLEDGED";
        } else {
          status = "ACKNOWLEDGED";
        }
      }

      noticeJson.acknowledgement_status = status;
      noticeJson.viewed_at = ack?.viewed_at || null;
      noticeJson.acknowledged_at = ack?.acknowledged_at || null;
      return noticeJson;
    });

    res.status(200).json({
      data: decoratedNotices,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        limit,
      },
      totalAll,
    });
  } catch (err) {
    console.error("Get Notices Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   VIEW NOTICE (Record viewed_at)
════════════════════════════════════════ */
const viewNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (
      req.user.role !== "SUPER_ADMIN" &&
      String(notice.society_id) !== String(req.user.society_id)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    const isAdminOrStaff = [
      "SUPER_ADMIN",
      "SOCIETY_ADMIN",
      "COMMITTEE_MEMBER",
      "ACCOUNTANT",
    ].includes(callerRole);

    if (!isAdminOrStaff && notice.target_type === "FLAT") {
      const isAuthorized = await isUserAuthorizedForFlat(
        req.user.id,
        notice.target_flat_id,
        notice.society_id
      );
      if (!isAuthorized) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    let ack = await NoticeAcknowledgement.findOne({
      where: { notice_id: id, user_id: req.user.id },
    });

    const now = new Date();
    if (!ack) {
      ack = await NoticeAcknowledgement.create({
        notice_id: id,
        user_id: req.user.id,
        viewed_at: now,
      });
    } else if (!ack.viewed_at) {
      ack.viewed_at = now;
      await ack.save();
    }

    let status = "NOT_REQUIRED";
    if (notice.acknowledgement_required) {
      if (!ack.viewed_at) status = "NOT_VIEWED";
      else if (!ack.acknowledged_at) status = "VIEWED_NOT_ACKNOWLEDGED";
      else status = "ACKNOWLEDGED";
    }

    res.status(200).json({
      success: true,
      acknowledgement_status: status,
      viewed_at: ack.viewed_at,
      acknowledged_at: ack.acknowledged_at,
    });
  } catch (err) {
    console.error("View Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   ACKNOWLEDGE NOTICE (Record acknowledged_at)
════════════════════════════════════════ */
const acknowledgeNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (
      req.user.role !== "SUPER_ADMIN" &&
      String(notice.society_id) !== String(req.user.society_id)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    const isAdminOrStaff = [
      "SUPER_ADMIN",
      "SOCIETY_ADMIN",
      "COMMITTEE_MEMBER",
      "ACCOUNTANT",
    ].includes(callerRole);

    if (!isAdminOrStaff && notice.target_type === "FLAT") {
      const isAuthorized = await isUserAuthorizedForFlat(
        req.user.id,
        notice.target_flat_id,
        notice.society_id
      );
      if (!isAuthorized) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (!notice.acknowledgement_required) {
      return res
        .status(400)
        .json({ message: "Acknowledgement is not required for this notice" });
    }

    let ack = await NoticeAcknowledgement.findOne({
      where: { notice_id: id, user_id: req.user.id },
    });

    const now = new Date();
    if (!ack) {
      ack = await NoticeAcknowledgement.create({
        notice_id: id,
        user_id: req.user.id,
        viewed_at: now,
        acknowledged_at: now,
      });
    } else {
      if (!ack.viewed_at) ack.viewed_at = now;
      if (!ack.acknowledged_at) ack.acknowledged_at = now;
      await ack.save();
    }

    res.status(200).json({
      success: true,
      message: "Notice acknowledged successfully",
      acknowledgement_status: "ACKNOWLEDGED",
      viewed_at: ack.viewed_at,
      acknowledged_at: ack.acknowledged_at,
    });
  } catch (err) {
    console.error("Acknowledge Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   GET NOTICE ACKNOWLEDGEMENTS HISTORY
   Authorized for SUPER_ADMIN, SOCIETY_ADMIN, COMMITTEE_MEMBER, ACCOUNTANT.
   Rejects residents with 403 Forbidden.
════════════════════════════════════════ */
const getNoticeAcknowledgements = async (req, res) => {
  try {
    const { id } = req.params;
    const { search, status } = req.query;

    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    const userRoles = new Set(req.user.roles || []);
    if (req.user.role) userRoles.add(req.user.role);
    if (req.user.activeRole) userRoles.add(req.user.activeRole);
    if (req.user.is_committee_member || req.user.is_committee) {
      userRoles.add("COMMITTEE_MEMBER");
    }
    if (userRoles.has("SOCIETY_ADMIN")) {
      userRoles.add("COMMITTEE_MEMBER");
    }

    let hasAccountantAccess = userRoles.has("ACCOUNTANT");
    if (!hasAccountantAccess && req.user.id) {
      const assignment = await AccountantAssignment.findOne({
        where: { user_id: req.user.id, status: "ACTIVE" },
      });
      if (assignment) hasAccountantAccess = true;
    }

    const isAllowed =
      userRoles.has("SUPER_ADMIN") ||
      userRoles.has("SOCIETY_ADMIN") ||
      userRoles.has("COMMITTEE_MEMBER") ||
      userRoles.has("COMMITTEE") ||
      hasAccountantAccess;

    if (!isAllowed) {
      return res.status(403).json({
        message: "Access denied: Resident cannot view acknowledgement history",
      });
    }

    if (
      !userRoles.has("SUPER_ADMIN") &&
      String(notice.society_id) !== String(req.user.society_id)
    ) {
      return res.status(403).json({
        message: "Access denied: Notice belongs to another society",
      });
    }

    // Find intended recipients
    const recipientsWhere = {
      society_id: notice.society_id,
      status: "ACTIVE",
    };

    if (notice.target_type === "FLAT" && notice.target_flat_id) {
      const flatAuthorizedUserIds = await getFlatAuthorizedUserIds(
        notice.target_flat_id,
        notice.society_id
      );
      recipientsWhere.id = { [Op.in]: flatAuthorizedUserIds.length ? flatAuthorizedUserIds : [-1] };
    } else {
      recipientsWhere.role = {
        [Op.in]: [
          "RESIDENT",
          "FAMILY_MEMBER",
          "COMMITTEE_MEMBER",
          "SOCIETY_ADMIN",
        ],
      };
    }

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

    // Fetch FlatMemberships for flat numbers
    const memberships =
      recipientIds.length > 0
        ? await FlatMembership.findAll({
            where: { user_id: { [Op.in]: recipientIds }, is_current: true },
            include: [{ model: Flat, attributes: ["flat_number"] }],
          })
        : [];

    const flatMap = {};
    memberships.forEach((m) => {
      if (m.Flat?.flat_number) flatMap[m.user_id] = m.Flat.flat_number;
    });

    // Fetch acknowledgements
    const acks =
      recipientIds.length > 0
        ? await NoticeAcknowledgement.findAll({
            where: { notice_id: id, user_id: { [Op.in]: recipientIds } },
          })
        : [];
    const ackMap = Object.fromEntries(acks.map((a) => [a.user_id, a]));

    let total = recipients.length;
    let viewedCount = 0;
    let ackCount = 0;

    let userList = recipients.map((r) => {
      const ack = ackMap[r.id];
      let userStatus = "NOT_VIEWED";
      if (ack && ack.acknowledged_at) {
        userStatus = "ACKNOWLEDGED";
        ackCount++;
        viewedCount++;
      } else if (ack && ack.viewed_at) {
        userStatus = "VIEWED_NOT_ACKNOWLEDGED";
        viewedCount++;
      }

      return {
        user_id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        role: r.role,
        flat_number: flatMap[r.id] || "—",
        viewed_at: ack?.viewed_at || null,
        acknowledged_at: ack?.acknowledged_at || null,
        status: userStatus,
      };
    });

    // Apply status filter
    if (status && status !== "ALL") {
      if (status === "ACKNOWLEDGED") {
        userList = userList.filter((u) => u.status === "ACKNOWLEDGED");
      } else if (status === "VIEWED" || status === "VIEWED_NOT_ACKNOWLEDGED") {
        userList = userList.filter(
          (u) => u.status === "VIEWED_NOT_ACKNOWLEDGED"
        );
      } else if (status === "NOT_VIEWED") {
        userList = userList.filter((u) => u.status === "NOT_VIEWED");
      }
    }

    res.status(200).json({
      notice: {
        id: notice.id,
        title: notice.title,
        description: notice.description,
        acknowledgement_required: Boolean(notice.acknowledgement_required),
        target_type: notice.target_type,
        target_flat_id: notice.target_flat_id,
        created_at: notice.created_at,
      },
      summary: {
        total,
        viewed: viewedCount,
        acknowledged: ackCount,
        pending: total - ackCount,
      },
      users: userList,
    });
  } catch (err) {
    console.error("Get Notice Acknowledgements Error:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createNotice,
  updateNotice,
  deleteNotice,
  getNotices,
  viewNotice,
  acknowledgeNotice,
  getNoticeAcknowledgements,
};