

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

    preapproval_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    /* Snapshot of the pass's allowed dwell time (minutes) at entry — lets
       guard UIs show the configured limit without a join, and lets the
       dwell cron notify the guard when it is exceeded. Null for manual
       (non-pass) entries. */
    dwell_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    /* Set to true once the dwell cron has alerted the guard for this log,
       so each overstay produces exactly one notification. */
    dwell_alerted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "visitorlogs",
    timestamps: false,
  }
);

module.exports = VisitorLog;
