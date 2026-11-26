const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FixedDeposit = sequelize.define(
  "FixedDeposit",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    fd_type: {
      type: DataTypes.ENUM("EXISTING", "NEW"),
      allowNull: false,
      defaultValue: "NEW",
    },
    funding_source: {
      type: DataTypes.ENUM("BANK", "CASH"),
      allowNull: true,
      defaultValue: null,
    },
    funding_account_id: { type: DataTypes.INTEGER, allowNull: true },
    fd_number: { type: DataTypes.STRING(80), allowNull: false },
    bank_name: { type: DataTypes.STRING(120), allowNull: false },
    principal_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    interest_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    maturity_date: { type: DataTypes.DATEONLY, allowNull: false },
    expected_maturity_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    total_interest_paid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    principal_returned: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    final_interest_received: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    total_interest_earned: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    loss_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    actual_received_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    interest_payout_type: {
      type: DataTypes.ENUM("CUMULATIVE", "MONTHLY", "QUARTERLY", "YEARLY", "ON_MATURITY"),
      allowNull: false,
      defaultValue: "ON_MATURITY",
    },
    receiving_account_id: { type: DataTypes.INTEGER, allowNull: true },
    status: {
      type: DataTypes.ENUM("ACTIVE", "MATURED", "CLOSED", "PREMATURE_CLOSED"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    closed_date: { type: DataTypes.DATEONLY, allowNull: true },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "fixed_deposits",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_fd_society_number",
        fields: ["society_id", "fd_number"],
      },
      { fields: ["society_id", "status"] },
      { fields: ["society_id", "maturity_date"] },
    ],
  }
);

module.exports = FixedDeposit;
