const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * One row per cleaning staff member per IST calendar day.
 *
 * The unique index on (cleaning_staff_id, attendance_date) is the real guarantee
 * that a guard cannot create two attendance rows for the same day: the scan
 * endpoint reads and updates the existing row rather than inserting a new one.
 *
 * `attendance_date` is always an IST calendar date (see utils/istTime.js), never
 * a UTC date, so a shift crossing midnight still rolls over at the IST boundary.
 *
 * `worked_minutes` is derived on OUT. Manual corrections overwrite it but must
 * also set `is_manual`, `manually_edited_by` and a reason in `notes`, so the
 * original gate data stays auditable.
 */
const CleaningStaffAttendance = sequelize.define(
  "CleaningStaffAttendance",
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

    /* IST calendar date: YYYY-MM-DD. */
    attendance_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    check_in: {
      type: DataTypes.DATE,
      allowNull: true,
      /* Explicit defaults so these serialize as null instead of being omitted
         from the JSON payload, which keeps the guard UI's checks predictable. */
      defaultValue: null,
    },

    check_out: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    /* Computed on OUT as (check_out - check_in). Null while still inside. */
    worked_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },

    /* Scans consumed today. First = IN, second = OUT. */
    scan_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    /* Which pass opened today's attendance, for audit. */
    pass_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    in_guard_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    out_guard_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    /* True once an admin corrects the row by hand. */
    is_manual: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    manually_edited_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    notes: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: "cleaning_staff_attendance",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "uniq_csa_attendance_staff_date",
        unique: true,
        fields: ["cleaning_staff_id", "attendance_date"],
      },
      { name: "idx_csa_attendance_society_date", fields: ["society_id", "attendance_date"] },
    ],
  }
);

module.exports = CleaningStaffAttendance;