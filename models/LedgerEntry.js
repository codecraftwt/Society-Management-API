const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/*
 * LedgerEntry = the single source of truth for a society's balance.
 * Balance is NEVER stored per entry; it is always computed as:
 *   opening_balance + ΣCREDIT − ΣDEBIT
 *
 * The unique key (society_id, source, reference_id, type) guarantees exactly
 * one CREDIT per bill / booking / expense while still allowing a single
 * reversal DEBIT (void/cancel) of the opposite type for the same reference.
 */
const LedgerEntry = sequelize.define(
  "LedgerEntry",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM("CREDIT", "DEBIT"), allowNull: false },
    // Which financial stream produced this entry.
    source: {
      type: DataTypes.ENUM("BILL", "MAINTENANCE", "AMENITY", "EXPENSE", "ADJUSTMENT"),
      allowNull: false,
    },
    // Bill id (BILL/MAINTENANCE), amenity booking id (AMENITY) or expense id (EXPENSE).
    reference_id: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    entry_date: { type: DataTypes.DATEONLY, allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    created_by_role: { type: DataTypes.STRING(50), allowNull: true },
    // POSTED = live entry. REVERSED = original entry whose effect was undone
    // by a matching reversal entry of the opposite type.
    status: { type: DataTypes.ENUM("POSTED", "REVERSED"), allowNull: false, defaultValue: "POSTED" },
    // Links a reversal entry to the original ledger entry it cancels out.
    reversal_of_id: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "ledger_entries",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        unique: true,
        name: "uq_ledger_income",
        fields: ["society_id", "source", "reference_id", "type"],
      },
      { fields: ["society_id", "entry_date"] },
    ],
  }
);

module.exports = LedgerEntry;