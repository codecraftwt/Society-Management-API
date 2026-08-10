
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ParkingRequest = sequelize.define("ParkingRequest", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  resident_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  flat_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  society_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  guest_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vehicle_number: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vehicle_type: {
    type: DataTypes.ENUM("CAR", "BIKE"),
    defaultValue: "CAR",
  },
  expected_arrival: {
    type: DataTypes.DATE,
    allowNull: true, // nullable for resident parking (no pre-scheduled arrival)
  },
  duration_hours: {
    type: DataTypes.INTEGER,
    defaultValue: 24,
  },
  status: {
    type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED", "COMPLETED"),
    defaultValue: "PENDING",
  },
  assigned_spot: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  /* ── NEW FIELDS ── */
  parking_type: {
    type: DataTypes.ENUM("VISITOR", "RESIDENT"),
    defaultValue: "VISITOR",
    allowNull: false,
  },
  vehicle_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // only populated for RESIDENT parking
  },

}, {
  timestamps: true,
  tableName: "parking_requests",
});

module.exports = ParkingRequest;