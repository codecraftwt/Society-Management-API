const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Flat = sequelize.define("Flat", {
  id: { 
    type: DataTypes.INTEGER, 
    primaryKey: true, 
    autoIncrement: true 
  },

  flat_number: { 
    type: DataTypes.STRING, 
    allowNull: false 
  },

  // ✅ Required for ALL (Apartment + RowHouse)
  block_id: { 
    type: DataTypes.INTEGER, 
    allowNull: false 
  },

  // ✅ Only for Apartments (RowHouse → null)
  floor_id: { 
    type: DataTypes.INTEGER, 
    allowNull: true 
  },

  resident_id: { 
    type: DataTypes.INTEGER, 
    allowNull: true 
  },

  // ✅ Flat type (1BHK, 2BHK, etc.)
  flat_type: {
    type: DataTypes.ENUM("1BHK", "2BHK", "3BHK"),
    allowNull: true,
    defaultValue: null,
  },
  occupancy_status: {
    type: DataTypes.ENUM("VACANT", "RENTED", "OWNER_OCCUPIED"),
    allowNull: true,
    defaultValue: "VACANT",
  }

}, {
  tableName: "flats",
  timestamps: false
});

module.exports = Flat;

