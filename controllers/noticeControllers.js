const Notice = require("../models/Notice");
const NoticeAcknowledgement = require("../models/NoticeAcknowledgement");
const Notification = require("../models/Notification");
const User = require("../models/User");
const UserSetting = require("../models/UserSetting");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const { sendPushNotification } = require("../utils/pushNotification");
const { Op } = require("sequelize");

/* ════════════════════════════════════════
   CREATE NOTICE
════════════════════════════════════════ */
const createNotice = async (req, res) => {
  try {
    const { title, description, acknowledgement_required, society_id } = req.body;

    let fileUrl = null;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    const isAckRequired = acknowledgement_required === true || acknowledgement_required === "true";

    const targetSocietyId = society_id
      ? parseInt(society_id, 10)
      : req.headers["x-society-id"]
      ? parseInt(req.headers["x-society-id"], 10)
      : req.user.society_id;

    if (!targetSocietyId || isNaN(targetSocietyId)) {
      return res.status(400).json({ message: "Please select a valid society to publish this notice." });
    }

    const callerRole = req.user.activeRole || req.user.role;
    const notice = await Notice.create({
      title,
      description,
      society_id: targetSocietyId,
      file_url: fileUrl,
      acknowledgement_required: isAckRequired,
      created_by_user_id: req.user.id,
      created_by_name: req.user.name || (callerRole === "COMMITTEE_MEMBER" ? "Committee Member" : "Society Admin"),
      created_by_role: callerRole,
    });

    // Emit to society room for real-time notice board update
    if (global.io) {
      global.io
        .to(`society_${targetSocietyId}`)
        .emit("notice_created", notice);
    }

    // Fetch residents to notify
    const residents = await User.findAll({
      where: {
        society_id: targetSocietyId,
        role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER", "COMMITTEE_MEMBER", "SOCIETY_ADMIN"] },
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
            { route: "/resident/notices", type: "NOTICE", noticeId: notice.id.toString() }
          ).catch((err) => console.error("Push Error:", err));
        }
      }
    }

    res.status(200).json(notice);
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
    const { title, description, acknowledgement_required } = req.body;

    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    if (callerRole === "COMMITTEE_MEMBER") {
      const isCreatedByAdmin = notice.created_by_role === "SOCIETY_ADMIN" || notice.created_by_role === "SUPER_ADMIN" || !notice.created_by_role;
      const isDifferentUser = notice.created_by_user_id && Number(notice.created_by_user_id) !== Number(req.user.id);
      if (isCreatedByAdmin || isDifferentUser) {
        return res.status(403).json({ message: "Committee members cannot modify Admin-created notices" });
      }
    }

    let fileUrl = notice.file_url;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    let isAckRequired = notice.acknowledgement_required;
    if (acknowledgement_required !== undefined) {
      isAckRequired = acknowledgement_required === true || acknowledgement_required === "true";
    }

    await notice.update({
      title: title || notice.title,
      description: description || notice.description,
      file_url: fileUrl,
      acknowledgement_required: isAckRequired,
    });

    res.status(200).json(notice);
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

    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const callerRole = req.user.activeRole || req.user.role;
    if (callerRole === "COMMITTEE_MEMBER") {
      const isCreatedByAdmin = notice.created_by_role === "SOCIETY_ADMIN" || notice.created_by_role === "SUPER_ADMIN" || !notice.created_by_role;
      const isDifferentUser = notice.created_by_user_id && Number(notice.created_by_user_id) !== Number(req.user.id);
      if (isCreatedByAdmin || isDifferentUser) {
        return res.status(403).json({ message: "Committee members cannot delete Admin-created notices" });
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
   GET NOTICES  (paginated + search + ack state)
════════════════════════════════════════ */
const getNotices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search = req.query.search?.trim() || "";
    const targetSocId = req.headers["x-society-id"] || req.query.society_id || req.user.society_id;
    const where = targetSocId ? { society_id: targetSocId } : {};

    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: notices } = await Notice.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const totalAll = search
      ? await Notice.count({ where: targetSocId ? { society_id: targetSocId } : {} })
      : count;

    // Attach acknowledgement status for logged-in user
    const noticeIds = notices.map((n) => n.id);
    const acks = await NoticeAcknowledgement.findAll({
      where: { notice_id: noticeIds, user_id: req.user.id },
    });
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

    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
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

    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!notice.acknowledgement_required) {
      return res.status(400).json({ message: "Acknowledgement is not required for this notice" });
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
   Authorized for SUPER_ADMIN, SOCIETY_ADMIN, COMMITTEE_MEMBER only.
   Rejects residents with 403 Forbidden.
════════════════════════════════════════ */
const getNoticeAcknowledgements = async (req, res) => {
  try {
    const { id } = req.params;
    const { search, status } = req.query;

    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    const userRole = req.user.activeRole || req.user.role;
    const allowedRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Access denied: Resident cannot view acknowledgement history" });
    }

    if (userRole !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied: Notice belongs to another society" });
    }

    // Find intended recipients (active users in society)
    const recipientsWhere = {
      society_id: notice.society_id,
      status: "ACTIVE",
      role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER", "COMMITTEE_MEMBER", "SOCIETY_ADMIN"] },
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

    // Fetch FlatMemberships for flat numbers
    const memberships = recipientIds.length > 0
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
    const acks = recipientIds.length > 0
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
        userList = userList.filter((u) => u.status === "VIEWED_NOT_ACKNOWLEDGED");
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