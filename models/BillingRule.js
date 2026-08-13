const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const BillingRule = sequelize.define(
  "BillingRule",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    frequency: {
      type: DataTypes.ENUM("MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"),
      allowNull: false,
      defaultValue: "MONTHLY",
    },
    description: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },
  },
  {
    tableName: "billing_rules",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = BillingRule;
