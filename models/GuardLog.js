const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GuardLog = sequelize.define("GuardLog", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true, // Prevent empty logs
    },
  },
  is_important: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  guard_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  society_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  timestamps: true, // Automatically adds createdAt (entry time) and updatedAt
  tableName: "guard_logs"
});

module.exports = GuardLog;