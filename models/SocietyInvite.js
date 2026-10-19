const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SocietyInvite = sequelize.define(
  "SocietyInvite",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "societies", key: "id" },
    },
    code: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    role_hint: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "RESIDENT",
    },
    max_uses: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    uses: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "society_invites",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = SocietyInvite;
