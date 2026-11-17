const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AmenityRule = sequelize.define(
  "AmenityRule",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    rule_type: {
      type: DataTypes.ENUM("TEXT", "IMAGE", "PDF"),
      allowNull: false,
      defaultValue: "TEXT",
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    formatted_content: {
      type: DataTypes.TEXT("medium"),
      allowNull: true,
    },
    is_mandatory: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "amenity_rules",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        fields: ["society_id", "is_active"],
        name: "idx_amenity_rules_society_active",
      },
    ],
  }
);

module.exports = AmenityRule;
