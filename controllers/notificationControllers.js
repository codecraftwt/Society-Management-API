
const Notification = require("../models/Notification");

/* ════════════════════════════════════════
   GET NOTIFICATIONS
   Returns all unread notifications for the
   currently logged-in user.
════════════════════════════════════════ */
exports.getNotifications = async (req, res) => {
  try {
    if (!req.user.id || !req.user.society_id)
      return res.status(400).json({ message: "Invalid user session" });

    const notifications = await Notification.findAll({
      where: {
        receiver_user_id: req.user.id,
        society_id:       req.user.society_id,
        is_read:          false,
      },
      order: [["createdAt", "DESC"]],
    });

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ════════════════════════════════════════
   MARK AS READ
════════════════════════════════════════ */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Scope the update to the requesting user — prevents one user
    //    marking another user's notifications as read.
    await Notification.update(
      { is_read: true },
      {
        where: {
          id,
          receiver_user_id: req.user.id,
        },
      }
    );

    // ✅ Emit socket event so the NotificationBell badge count drops in
    //    real-time without the client needing to re-fetch.
    if (global.io) {
      global.io
        .to(`user_${req.user.id}`)
        .emit("notification_read", { id: parseInt(id) });
    }

    res.json({ message: "Notification marked read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ════════════════════════════════════════
   MARK ALL AS READ
════════════════════════════════════════ */
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_user_id: req.user.id,
          society_id:       req.user.society_id,
          is_read:          false,
        },
      }
    );

    if (global.io) {
      global.io
        .to(`user_${req.user.id}`)
        .emit("notifications_all_read");
    }

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ════════════════════════════════════════
   CLEAR NOTIFICATIONS
   Deletes ALL notifications for the user
   (read + unread).
════════════════════════════════════════ */
exports.clearNotifications = async (req, res) => {
  try {
    await Notification.destroy({
      where: {
        society_id:       req.user.society_id,
        receiver_user_id: req.user.id,
      },
    });

    if (global.io) {
      global.io
        .to(`user_${req.user.id}`)
        .emit("notifications_cleared");
    }

    res.json({ message: "Notifications cleared" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};