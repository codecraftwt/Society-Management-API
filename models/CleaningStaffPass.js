const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * A gate pass that lets one cleaning staff member into the society.
 *
 * Scanned by an on-duty guard at the gate. Deliberately NOT a VisitorPreApproval
 * row: cleaning staff are staff, and reusing the visitor tables would mix two
 * different lifecycles (who invited them, resident notifications, OTP) that do
 * not apply here.
 *
 * Rules enforced by this table + the controller:
 *  - `pass_code` is unique at the database level (index below).
 *  - At most one ACTIVE pass may cover any given day for a staff member.
 *  - `max_scans_per_day` is fixed at 2 (IN then OUT). It is stored rather than
 *    hard-coded so the value is auditable, but the server never lets a client
 *    raise it.
 */
const CleaningStaffPass = sequelize.define(
  "CleaningStaffPass",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    cleaning_staff_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    /* Format: CMP-XXXXXXXX. Unique constraint enforced by MySQL. */
    pass_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },

    valid_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    /* Null means a single-day pass; set for multi-day passes. */
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "EXPIRED", "REVOKED"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },

    /* Fixed at 2 (entry + exit). Never accepted from client input. */
    max_scans_per_day: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    },

    issued_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    revoked_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    revoke_reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: "cleaning_staff_passes",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "uniq_cleaning_pass_code", unique: true, fields: ["pass_code"] },
      { name: "idx_csp_staff", fields: ["cleaning_staff_id"] },
      { name: "idx_csp_society", fields: ["society_id"] },
      { name: "idx_csp_society_status", fields: ["society_id", "status"] },
    ],
  }
);

module.exports = CleaningStaffPass;