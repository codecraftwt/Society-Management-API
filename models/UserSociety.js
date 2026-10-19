const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserSociety = sequelize.define(
  "UserSociety",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "societies", key: "id" },
    },
    membership_status: {
      type: DataTypes.ENUM("PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "LEFT"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    resident_type: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: true,
      defaultValue: null,
    },
    occupant_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
    },
    vehicle_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
    emergency_contact: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    source: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "MIGRATED",
    },
    invited_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    approved_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    joined_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "user_societies",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = UserSociety;
