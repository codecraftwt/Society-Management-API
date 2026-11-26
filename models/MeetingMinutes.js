const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MeetingMinutes = sequelize.define(
  "MeetingMinutes",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    category_id: { type: DataTypes.INTEGER, allowNull: false },
    meeting_title: { type: DataTypes.STRING(255), allowNull: false },
    meeting_date: { type: DataTypes.DATEONLY, allowNull: false },
    agenda: { type: DataTypes.TEXT, allowNull: false },
    minutes: { type: DataTypes.TEXT("long"), allowNull: false },
    decisions: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    updated_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "meeting_minutes",
    timestamps: true,
    paranoid: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
    indexes: [
      { fields: ["society_id", "meeting_date"] },
      { fields: ["society_id", "category_id"] },
      { fields: ["deleted_at"] },
    ],
  }
);

module.exports = MeetingMinutes;
