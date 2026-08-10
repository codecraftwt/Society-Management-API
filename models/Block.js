const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Block = sequelize.define("Block", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
   property_type: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    defaultValue: "Apartments" 
  }
}, {
  tableName: "blocks",
  timestamps: false
});

module.exports = Block;
