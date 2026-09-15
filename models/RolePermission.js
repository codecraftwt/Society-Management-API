const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RolePermission = sequelize.define(
  "RolePermission",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // null represents global default template
    },
    role: {
      type: DataTypes.ENUM("COMMITTEE_MEMBER", "ACCOUNTANT"),
      allowNull: false,
    },
    module: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    actions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "role_permissions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = RolePermission;
