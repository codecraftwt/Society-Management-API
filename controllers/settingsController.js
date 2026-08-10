const UserSetting = require("../models/UserSetting");

/* GET /api/settings */
exports.getSettings = async (req, res) => {
  try {
    const [settings] = await UserSetting.findOrCreate({
      where: { user_id: req.user.id },
      defaults: {
        emergency_alerts: true,
        visitor_entry: true,
        complaint_updates: true,   // ✅ TRUE
        notice_updates: true,      // ✅ TRUE
        sound_alerts: true,
        auto_logout: true,
      },
    });

    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* PUT /api/settings */
exports.updateSettings = async (req, res) => {
  try {
    const {
      emergency_alerts,
      visitor_entry,
      complaint_updates,
      notice_updates,
      sound_alerts,
      auto_logout,
    } = req.body;

    const [userSettings] = await UserSetting.findOrCreate({
      where: { user_id: req.user.id },
      defaults: {
        emergency_alerts: true,
        visitor_entry: true,
        complaint_updates: true,
        notice_updates: true,
        sound_alerts: true,
        auto_logout: true,
      },
    });

    const updates = {};

    if (emergency_alerts !== undefined)  updates.emergency_alerts  = emergency_alerts;
    if (visitor_entry !== undefined)     updates.visitor_entry     = visitor_entry;
    if (complaint_updates !== undefined) updates.complaint_updates = complaint_updates;
    if (notice_updates !== undefined)    updates.notice_updates    = notice_updates;
    if (sound_alerts !== undefined)      updates.sound_alerts      = sound_alerts;
    if (auto_logout !== undefined)       updates.auto_logout       = auto_logout;

    await userSettings.update(updates);
    await userSettings.reload();

    res.json({
      message: "Settings saved",
      data: userSettings,
    });

  } catch (err) {
    console.error("Update Settings Error:", err);
    res.status(500).json({ message: err.message });
  }
};