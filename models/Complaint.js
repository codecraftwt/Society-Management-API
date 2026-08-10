const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Complaint = sequelize.define("Complaint", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  resident_id: { type: DataTypes.INTEGER, allowNull: false },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  flat_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('OPEN','IN_PROGRESS','RESOLVED'), defaultValue: 'OPEN' },
  photo_url: { type: DataTypes.STRING },
photo_public_id: { type: DataTypes.STRING },
}, {
  tableName: "complaints",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Complaint;
