const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Floor = sequelize.define("Floor", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  floor_number: { type: DataTypes.STRING, allowNull: false },
  block_id: { type: DataTypes.INTEGER, allowNull: false } 
}, {
  tableName: "floors",
  timestamps: false
});

module.exports = Floor;