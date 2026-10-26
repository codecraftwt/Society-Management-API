const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Notification = sequelize.define("Notification", {

  title: DataTypes.STRING,

  message: DataTypes.TEXT,

  type: DataTypes.STRING,
  action_type: DataTypes.STRING,
  action_route: DataTypes.STRING,

  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },

  society_id: DataTypes.INTEGER,

  user_id: DataTypes.INTEGER,

  receiver_role: DataTypes.STRING,

  receiver_user_id: DataTypes.INTEGER,

  source_event_id: {
    type: DataTypes.STRING(191),
    allowNull: true,
    defaultValue: null
  },

  push_status: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: null
  },

  push_attempted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },

  push_error: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  }

}, {
  tableName: "notifications",
  // Notification schema changes are owned by migrations/003_guard_attendance_automation.js.
  // Keeping this index here makes sequelize.sync() try to create it before the
  // migration has added source_event_id, which prevents the API from starting.
});

module.exports = Notification;


