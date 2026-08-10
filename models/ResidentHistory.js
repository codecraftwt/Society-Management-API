const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ResidentHistory = sequelize.define(
  "ResidentHistory",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    move_in_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    move_out_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    is_current: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "resident_history",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = ResidentHistory;