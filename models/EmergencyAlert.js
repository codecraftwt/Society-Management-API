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

source: {
  type: DataTypes.ENUM("GUARD", "RESIDENT"),
  allowNull: false
}
,

  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },

  resolved_at: {
    type: DataTypes.DATE
  }

}, {
  tableName: "emergency_alerts",
  timestamps: false
});

module.exports = EmergencyAlert;
