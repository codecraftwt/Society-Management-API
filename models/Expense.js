const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/*
 * Expense = MONEY-OUT. Every POSTED expense produces exactly one LedgerEntry
 * DEBIT. Voiding an expense (soft delete) reverses the ledger impact with a
 * matching CREDIT entry so the society balance stays correct.
 */
const Expense = sequelize.define("Expense", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  pay_to: { type: DataTypes.STRING(255), allowNull: false },
  reason: { type: DataTypes.STRING(255), allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  payment_date: { type: DataTypes.DATEONLY, allowNull: false },
  paid_by: {
    type: DataTypes.ENUM("SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER", "SUPER_ADMIN"),
    allowNull: false,
  },
  payment_mode: {
    type: DataTypes.ENUM("CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"),
    allowNull: false,
    defaultValue: "CASH",
  },
  receipt_url: { type: DataTypes.STRING(500), allowNull: true },
  // POSTED -> money out happened. VOID -> soft deleted + ledger reversal.
  status: { type: DataTypes.ENUM("POSTED", "VOID"), allowNull: false, defaultValue: "POSTED" },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: "expenses",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
});

module.exports = Expense;