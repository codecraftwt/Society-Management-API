const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * One row per guard per shift per IST calendar day.
 *
 * The unique constraint on (guard_id, shift_id, attendance_date) is the
 * server-authoritative guarantee that no duplicate punch-in can exist.
 * All validations (GPS, geofence, selfie, shift window) are done BEFORE
 * this row is written — never patched after the fact except by an admin
 * manual correction (is_manual = true).
 *
 * attendance_date is always an IST calendar date (see utils/istTime.js),
 * so a NIGHT shift crossing midnight rolls over at the IST boundary.
 *
 * punch_in / punch_out are UTC timestamps (Sequelize DataTypes.DATE).
 * lat/lng are stored exactly as received from the guard's device —
 * the server already verified they were inside the geofence.
 */
const GuardAttendance = sequelize.define(
  "GuardAttendance",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    guard_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    shift_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    /* IST calendar date: YYYY-MM-DD. Never a UTC date. */
    attendance_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    /* ── Punch-In ── */
    punch_in: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    punch_in_lat: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      defaultValue: null,
    },

    punch_in_lng: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      defaultValue: null,
    },

    /* Reported GPS accuracy at punch-in (metres) */
    punch_in_accuracy: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },

    /* Distance from society at punch-in (metres) */
    punch_in_distance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },

    /* Radius used for verification at punch-in (metres) */
    punch_in_radius: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      defaultValue: null,
    },

    /* Cloudinary public_id of the punch-in selfie */
    punch_in_selfie_public_id: {
      type: DataTypes.STRING(300),
      allowNull: true,
      defaultValue: null,
    },

    /* Delivery URL for the punch-in selfie */
    punch_in_selfie_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },

    /* ── Punch-Out ── */
    punch_out: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    punch_out_lat: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      defaultValue: null,
    },

    punch_out_lng: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      defaultValue: null,
    },

    punch_out_accuracy: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },

    punch_out_distance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },

    punch_out_selfie_public_id: {
      type: DataTypes.STRING(300),
      allowNull: true,
      defaultValue: null,
    },

    punch_out_selfie_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },

    /* Computed on punch-out as Math.round((punch_out - punch_in) / 60000). */
    worked_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },

    /* PUNCHED_IN | PUNCHED_OUT */
    status: {
      type: DataTypes.ENUM("PUNCHED_IN", "PUNCHED_OUT"),
      allowNull: false,
      defaultValue: "PUNCHED_IN",
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
      defaultValue: null,
    },

    notes: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "guard_attendance",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "uniq_ga_guard_shift_date",
        unique: true,
        fields: ["guard_id", "shift_id", "attendance_date"],
      },
      {
        name: "idx_ga_society_date",
        fields: ["society_id", "attendance_date"],
      },
    ],
  }
);

module.exports = GuardAttendance;