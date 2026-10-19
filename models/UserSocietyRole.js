const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserSocietyRole = sequelize.define(
  "UserSocietyRole",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "user_societies", key: "id" },
    },
    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
  },
  {
    tableName: "user_society_roles",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = UserSocietyRole;
