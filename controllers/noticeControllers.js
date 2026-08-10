const Notice       = require("../models/Notice");
const Notification = require("../models/Notification");
const User         = require("../models/User");
const UserSetting  = require("../models/UserSetting");
const { sendPushNotification } = require("../utils/pushNotification");
const { Op } = require("sequelize");

/* ════════════════════════════════════════
   CREATE NOTICE
════════════════════════════════════════ */
const createNotice = async (req, res) => {
  try {
    const { title, description } = req.body;

    let fileUrl = null;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    const notice = await Notice.create({
      title,
      description,
      society_id: req.user.society_id,
      file_url:   fileUrl,
    });

    // Emit to society room for real-time notice board update
    if (global.io) {
      global.io
        .to(`society_${req.user.society_id}`)
        .emit("notice_created", notice);
    }

    // ✅ Fetch RESIDENT + FAMILY_MEMBER + COMMITTEE_MEMBER
    // ✅ Exclude the sender themselves
    const residents = await User.findAll({
      where: {
        society_id: req.user.society_id,
        role:       { [Op.in]: ["RESIDENT", "FAMILY_MEMBER", "COMMITTEE_MEMBER"] },
        status:     "ACTIVE",
        id:         { [Op.ne]: req.user.id }, // ✅ never notify the sender
      },
      attributes: ["id", "fcm_token"],
    });

    const residentIds = residents.map((r) => r.id);
    const allSettings = await UserSetting.findAll({
      where:      { user_id: residentIds },
      attributes: ["user_id", "notice_updates"],
    });
    const settingsMap = Object.fromEntries(
      allSettings.map((s) => [s.user_id, s])
    );

    for (const resident of residents) {
      const settings = settingsMap[resident.id];

      if (!settings || settings.notice_updates === true) {
        const notification = await Notification.create({
          title:            "Society Notice",
          message:          `📢 New notice posted: "${title}"`,
          type:             "NOTICE",
          action_type:      "VIEW_NOTICE",
          action_route:     "/resident/notices",
          society_id:       req.user.society_id,
          user_id:          req.user.id,   // sender
          receiver_role:    "RESIDENT",
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
            { route: "/resident/notices", noticeId: notice.id.toString() }
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
   Allows updating title, description, and file.
════════════════════════════════════════ */
const updateNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    const notice = await Notice.findByPk(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    // Security check: must be same society (SuperAdmin bypass handled by middleware setting society_id)
    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    let fileUrl = notice.file_url;
    if (req.file) {
      const originalName = encodeURIComponent(req.file.originalname);
      fileUrl = `${req.file.path}?filename=${originalName}`;
    }

    await notice.update({
      title:       title || notice.title,
      description: description || notice.description,
      file_url:    fileUrl,
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

    // Security check
    if (req.user.role !== "SUPER_ADMIN" && String(notice.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    await notice.destroy();
    res.status(200).json({ message: "Notice deleted successfully" });
  } catch (err) {
    console.error("Delete Notice Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ════════════════════════════════════════
   GET NOTICES  (paginated + search)
════════════════════════════════════════ */
const getNotices = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search = req.query.search?.trim() || "";

    // SuperAdmin can see all if society_id not provided
    const where = req.user.society_id ? { society_id: req.user.society_id } : {};

    if (search) {
      where[Op.or] = [
        { title:       { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: notices } = await Notice.findAndCountAll({
      where,
      order:  [["created_at", "DESC"]],
      limit,
      offset,
    });

    const totalAll = search
      ? await Notice.count({ where: req.user.society_id ? { society_id: req.user.society_id } : {} })
      : count;

    res.status(200).json({
      data: notices,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      totalAll,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createNotice, updateNotice, deleteNotice, getNotices };