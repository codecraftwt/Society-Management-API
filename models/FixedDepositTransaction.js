const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FixedDepositTransaction = sequelize.define(
  "FixedDepositTransaction",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    fixed_deposit_id: { type: DataTypes.INTEGER, allowNull: false },
    transaction_type: {
      type: DataTypes.ENUM(
        "EXISTING_REGISTER",
        "NEW_FUNDING",
        "INTEREST_PAYOUT",
        "MATURITY",
        "PREMATURE_CLOSURE"
      ),
      allowNull: false,
    },
    transaction_date: { type: DataTypes.DATEONLY, allowNull: false },
    transaction_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    principal_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    interest_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    loss_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    financial_account_id: { type: DataTypes.INTEGER, allowNull: true },
    reference_no: { type: DataTypes.STRING(100), allowNull: true },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "fd_transactions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      { fields: ["society_id", "fixed_deposit_id"] },
      { fields: ["society_id", "transaction_date"] },
    ],
  }
);

module.exports = FixedDepositTransaction;
