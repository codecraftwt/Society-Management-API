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
  },
  {
    tableName: "visitor_preapprovals",
    timestamps: true,
  }
);

module.exports = VisitorPreApproval;
