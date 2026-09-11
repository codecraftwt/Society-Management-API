const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AccountantAssignment = sequelize.define(
  "AccountantAssignment",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    is_from_society: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_society_resident: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    inactive_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      defaultValue: "ACTIVE",
    },
    appointed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "accountant_assignments",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = AccountantAssignment;
