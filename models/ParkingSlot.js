

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const ParkingSlot = sequelize.define(
  "ParkingSlot",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: {
      type: DataTypes.INTEGER, allowNull: false,
      unique: "unique_slot_per_society",
    },
    parking_floor: { type: DataTypes.STRING, allowNull: true },
    slot_number: {
      type: DataTypes.STRING, allowNull: false,
      unique: "unique_slot_per_society",
    },
    flat_id:     { type: DataTypes.INTEGER, allowNull: true },
    resident_id: { type: DataTypes.INTEGER, allowNull: true },
    vehicle_type: { type: DataTypes.ENUM("CAR", "BIKE"), allowNull: false },
    status: {
      type: DataTypes.ENUM("AVAILABLE", "ASSIGNED"),
      defaultValue: "AVAILABLE",
    },
    // ✅ ADD THIS
    parking_type: {
      type: DataTypes.ENUM("DEFAULT", "EXTRA"),
      defaultValue: "DEFAULT",
      allowNull: false,
    },
  },
  { tableName: "parking_slots", timestamps: true }
);

module.exports = ParkingSlot;