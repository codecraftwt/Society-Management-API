const notificationService = require("../services/notificationService");

/* ════════════════════════════════════════
   GET NOTIFICATIONS
   Returns all unread notifications for the
   currently logged-in user in their society.
════════════════════════════════════════ */
exports.getNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user.id || !req.user.society_id) {
      return res.status(400).json({ message: "Invalid user session" });
    }

    const notifications = await notificationService.getUserNotifications(
      req.user.id,
      req.user.society_id
    );

    res.json(notifications);
  } catch (error) {
    console.error("[NotificationController] getNotifications error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/* ════════════════════════════════════════
   MARK AS READ
   Marks a single notification as read,
   scoped to the requesting user & society.
════════════════════════════════════════ */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.user.id || !req.user.society_id) {
      return res.status(400).json({ message: "Invalid user session" });
    }

    const result = await notificationService.markAsRead(
      id,
      req.user.id,
      req.user.society_id
    );

    if (result.found && result.authorized === false) {
      return res.status(403).json({ message: "Unauthorized to mark this notification as read" });
    }

    // Emit socket event with safe ID (supports both numeric and string IDs without NaN)
    if (global.io) {
      global.io
        .to(`user_${req.user.id}`)
        .emit("notification_read", { id: isNaN(Number(id)) ? String(id) : Number(id) });
    }

    res.json({ message: "Notification marked read" });
  } catch (error) {
    console.error("[NotificationController] markAsRead error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/* ════════════════════════════════════════
   CLEAR NOTIFICATIONS
   Deletes notifications for the user
   scoped to their current society.
════════════════════════════════════════ */
exports.clearNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user.id || !req.user.society_id) {
      return res.status(400).json({ message: "Invalid user session" });
    }

    await notificationService.clearUserNotifications(
      req.user.id,
      req.user.society_id
    );

    if (global.io) {
      global.io
        .to(`user_${req.user.id}`)
        .emit("notifications_cleared");
    }

    res.json({ message: "Notifications cleared" });
  } catch (err) {
    console.error("[NotificationController] clearNotifications error:", err.message);
    res.status(500).json({ message: err.message });
  }
};