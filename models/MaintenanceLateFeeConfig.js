const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MaintenanceLateFeeConfig = sequelize.define(
  "MaintenanceLateFeeConfig",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "societies", key: "id" },
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    fee_type: {
      type: DataTypes.ENUM("FIXED_PER_MONTH", "FIXED_ONE_TIME", "PERCENT_PER_MONTH"),
      allowNull: false,
      defaultValue: "FIXED_PER_MONTH",
    },
    fee_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    grace_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    max_fee_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "maintenance_late_fee_configs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_maintenance_late_fee_society",
        fields: ["society_id"],
      },
    ],
  }
);

module.exports = MaintenanceLateFeeConfig;
