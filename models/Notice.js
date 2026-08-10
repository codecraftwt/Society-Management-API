const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Notice = sequelize.define("Notice", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  file_url: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: "notices",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Notice;
