const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AmenityRuleAttachment = sequelize.define(
  "AmenityRuleAttachment",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    rule_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    file_url: {
      type: DataTypes.STRING(1000),
      allowNull: false,
    },
    file_type: {
      type: DataTypes.ENUM("PDF", "IMAGE"),
      allowNull: false,
    },
    file_size: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "amenity_rule_attachments",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        fields: ["rule_id"],
        name: "idx_amenity_rule_attachments_rule",
      },
    ],
  }
);

module.exports = AmenityRuleAttachment;
