const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Amenity = sequelize.define("Amenity", {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  name:       { type: DataTypes.STRING,  allowNull: false },
  icon:       { type: DataTypes.STRING,  defaultValue: "apartment" },

  type: {
    type: DataTypes.ENUM("FREE", "PAID"),
    defaultValue: "FREE",
  },

  booking_type: {
    type: DataTypes.ENUM("SLOT", "FULL_DAY"),
    defaultValue: "SLOT",
  },

  rate_per_hour:    { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  opening_time:     { type: DataTypes.TIME,    allowNull: true },
  closing_time:     { type: DataTypes.TIME,    allowNull: true },
  slot_duration:    { type: DataTypes.INTEGER, defaultValue: 60 },
  capacity:         { type: DataTypes.INTEGER, defaultValue: 1 },
  is_active:        { type: DataTypes.BOOLEAN, defaultValue: true },
  requires_approval:{ type: DataTypes.BOOLEAN, defaultValue: false },

  /* ── Disable / closure fields ── */
  disable_type: {
    type: DataTypes.ENUM("TEMPORARY", "PERMANENT"),
    allowNull: true,
    defaultValue: null,
  },

  disabled_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null,
  },

  disabled_from: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    defaultValue: null,
  },

  disabled_until: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    defaultValue: null,
  },

}, { timestamps: true, tableName: "amenities" });

module.exports = Amenity;