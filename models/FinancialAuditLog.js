const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/*
 * Append-only security log for sensitive financial operations:
 * opening balance changes, expense edits/voids, manual adjustments.
 */
const FinancialAuditLog = sequelize.define("FinancialAuditLog", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  action: {
    type: DataTypes.ENUM(
      "OPENING_BALANCE_SET",
      "OPENING_BALANCE_ADJUST",
      "EXPENSE_CREATE",
      "EXPENSE_UPDATE",
      "EXPENSE_VOID",
      "PAYMENT_REVERSED",
      "MANUAL_ADJUSTMENT"
    ),
    allowNull: false,
  },
  entity_type: { type: DataTypes.STRING(60), allowNull: true },
  entity_id: { type: DataTypes.INTEGER, allowNull: true },
  old_value: { type: DataTypes.JSON, allowNull: true },
  new_value: { type: DataTypes.JSON, allowNull: true },
  reason: { type: DataTypes.TEXT, allowNull: true },
  performed_by: { type: DataTypes.INTEGER, allowNull: true },
  performed_by_role: { type: DataTypes.STRING(50), allowNull: true },
  performed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: "financial_audit_logs",
  timestamps: false,
});

module.exports = FinancialAuditLog;