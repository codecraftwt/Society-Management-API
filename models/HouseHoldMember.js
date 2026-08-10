const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const HouseHoldMember = sequelize.define(
  "HouseHoldMember",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    relation: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // ✅ ADDED — stores email for later User account creation on admin toggle
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    work: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    isAdmin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "household_members",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = HouseHoldMember;