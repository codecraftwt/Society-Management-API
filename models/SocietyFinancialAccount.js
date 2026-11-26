const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SocietyFinancialAccount = sequelize.define(
  "SocietyFinancialAccount",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    account_name: { type: DataTypes.STRING(120), allowNull: false },
    account_type: {
      type: DataTypes.ENUM("SAVINGS", "CURRENT", "CASH", "OTHER"),
      allowNull: false,
      defaultValue: "SAVINGS",
    },
    bank_name: { type: DataTypes.STRING(120), allowNull: true },
    account_holder_name: { type: DataTypes.STRING(150), allowNull: true },
    account_number: { type: DataTypes.STRING(50), allowNull: true },
    ifsc_code: { type: DataTypes.STRING(20), allowNull: true },
    branch_name: { type: DataTypes.STRING(120), allowNull: true },
    opening_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    opening_balance_date: { type: DataTypes.DATEONLY, allowNull: true },
    current_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "society_financial_accounts",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["society_id", "status"] },
      { fields: ["society_id", "account_type"] },
    ],
  }
);

module.exports = SocietyFinancialAccount;
