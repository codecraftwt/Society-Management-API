const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const EmergencyAlert = sequelize.define("EmergencyAlert", {

  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  message: {
    type: DataTypes.STRING,
    allowNull: false
  },

  guard_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },

  society_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  status: {
    type: DataTypes.ENUM("ACTIVE", "RESOLVED"),
    defaultValue: "ACTIVE"
  },
  type: {
  type: DataTypes.STRING,
  allowNull: false
},
 resident_id: {
  type: DataTypes.INTEGER,
  allowNull: true
},

flat_id: {
  type: DataTypes.INTEGER,
  allowNull: true
},

admin_id: {
  type: DataTypes.INTEGER,
  allowNull: true
},

source: {
  type: DataTypes.ENUM("GUARD", "RESIDENT", "ADMIN", "COMMITTEE", "SUPER_ADMIN"),
  allowNull: false
}
,

  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },

  resolved_at: {
    type: DataTypes.DATE
  },

  resolved_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },

  resolution_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },

  other_reason: {
    type: DataTypes.STRING,
    allowNull: true
  }

}, {
  tableName: "emergency_alerts",
  timestamps: false
});

module.exports = EmergencyAlert;
