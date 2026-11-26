const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GuardShiftPlace = sequelize.define(
  "GuardShiftPlace",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "guard_shift_places",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["society_id", "name"],
        name: "uq_guard_shift_places_society_name",
      },
    ],
  }
);

module.exports = GuardShiftPlace;
