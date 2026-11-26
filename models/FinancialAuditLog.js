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
      "MANUAL_ADJUSTMENT",
      "MAINTENANCE_CONFIG_CREATED",
      "MAINTENANCE_CONFIG_UPDATED",
      "MAINTENANCE_CONFIG_DELETED",
      "MAINTENANCE_GENERATED",
      "FINANCIAL_ACCOUNT_CREATE",
      "FINANCIAL_ACCOUNT_UPDATE",
      "FINANCIAL_ACCOUNT_STATUS",
      "CASH_IN_ENTRY",
      "CASH_ADJUSTMENT",
      "ACCOUNT_TRANSFER",
      "EXPENSE_CATEGORY_CREATE",
      "EXPENSE_CATEGORY_UPDATE",
      "EXPENSE_CATEGORY_DELETE",
      "FD_EXISTING_REGISTER",
      "FD_NEW_CREATE",
      "FD_UPDATE",
      "FD_INTEREST_PAYOUT",
      "FD_MATURE",
      "FD_PREMATURE_CLOSE"
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