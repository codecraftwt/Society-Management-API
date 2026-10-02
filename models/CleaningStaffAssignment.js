const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * Where a cleaning staff member is scheduled to work.
 *
 * Assignments are the society's view of "who cleans what, when". They are
 * independent of gate passes: an assignment says the staff member *should* be
 * on site, a pass says they are allowed through the gate today.
 *
 * `flat_id` is optional because most cleaning work is per-block or per-society.
 * `assigned_date` anchors the assignment; `end_date` may be null for open-ended
 * recurring work (e.g. a permanent block assignment).
 */
const CleaningStaffAssignment = sequelize.define(
  "CleaningStaffAssignment",
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

    /* Optional scope narrowing — leave null for society-wide work. */
    block_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    /* DAILY   → attends every day of the range.
       SHIFT   → attends on the listed weekdays only (weekday_mask).
       ONCE    → attends exactly on assigned_date. */
    work_type: {
      type: DataTypes.ENUM("DAILY", "SHIFT", "ONCE"),
      allowNull: false,
      defaultValue: "DAILY",
    },

    /* MORNING | EVENING | FULL_DAY — only meaningful when work_type is DAILY or SHIFT. */
    shift: {
      type: DataTypes.ENUM("MORNING", "EVENING", "FULL_DAY"),
      allowNull: true,
      defaultValue: "FULL_DAY",
    },

    /* Bit mask, Sunday = 0 ... Saturday = 6, used when work_type is SHIFT. */
    weekday_mask: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    assigned_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    /* Null means the assignment continues indefinitely. */
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "COMPLETED", "CANCELLED"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },

    notes: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    assigned_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "cleaning_staff_assignments",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "idx_csa_staff", fields: ["cleaning_staff_id"] },
      { name: "idx_csa_society", fields: ["society_id"] },
      { name: "idx_csa_society_date", fields: ["society_id", "assigned_date"] },
    ],
  }
);

module.exports = CleaningStaffAssignment;