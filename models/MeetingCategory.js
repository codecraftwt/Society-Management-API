const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MeetingCategory = sequelize.define(
  "MeetingCategory",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "meeting_categories",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_meeting_cat_society_name",
        fields: ["society_id", "name"],
      },
      { fields: ["society_id", "is_active"] },
    ],
  }
);

module.exports = MeetingCategory;
