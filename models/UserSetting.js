const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserSetting = sequelize.define(
  "UserSetting",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },

    // ── Notification toggles ──
    emergency_alerts: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    visitor_entry: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    complaint_updates: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,   // ✅ NOW TRUE
    },
    notice_updates: {       // ✅ RENAMED
      type: DataTypes.BOOLEAN,
      defaultValue: true,   // ✅ NOW TRUE
    },

    // ── Preference toggles ──
    sound_alerts: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    auto_logout: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "user_settings",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = UserSetting;