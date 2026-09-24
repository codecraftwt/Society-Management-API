const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VisitorPreApproval = sequelize.define(
  "VisitorPreApproval",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    resident_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Allow true for backward compatibility
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
      type: DataTypes.STRING,
      allowNull: false,
    },

    otp: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM("PENDING", "USED", "EXPIRED"),
      defaultValue: "PENDING",
    },

    valid_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    /* ── Daily Pass fields ──
       pass_type  : 'SINGLE' (legacy one-day pass) | 'DAILY' (multi-day range,
                    max `daily_limit` scans per IST day — entry + exit).
       valid_until: end of the date range for DAILY passes (null for SINGLE).
       daily_limit: max scans allowed per calendar day for DAILY passes. */
    pass_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "SINGLE",
    },

    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    daily_limit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    },

    /* ── Dwell limit ──
       Allowed minutes the visitor may stay inside. When exceeded, the
       backend notifies the on-duty guard. Default 45 preserves the legacy
       frontend behaviour for existing passes. */
    dwell_minutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45,
    },
  },
  {
    tableName: "visitor_preapprovals",
    timestamps: true,
  }
);

module.exports = VisitorPreApproval;
