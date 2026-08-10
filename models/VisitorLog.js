

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); 

const VisitorLog = sequelize.define(
  "VisitorLog",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    visitor_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    mobile: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    vehicle_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    purpose: {
      type: DataTypes.ENUM(
        "MAINTENANCE",
        "DELIVERY",
        "GUEST",
        "CAB",
        "SERVICE",
        "OTHER"
      ),
      allowNull: false,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    guard_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    entry_time: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    exit_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "visitorlogs",
    timestamps: false,
  }
);

module.exports = VisitorLog;
