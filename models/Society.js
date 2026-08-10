const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Society = sequelize.define("Society", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.TEXT },
 
}, {
  tableName: "societies",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Society;



