const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Document = sequelize.define(
  "Document",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    category: {
      type: DataTypes.ENUM("Legal", "Meetings", "Guidelines", "Finance", "Security"),
      allowNull: false,
    },

    file_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    file_url: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    file_size: {
      type: DataTypes.BIGINT,   // stored in bytes
      allowNull: true,
    },

    mime_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    uploaded_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // ALL_RESIDENTS   → RESIDENT + FAMILY_MEMBER (must have a flat)
    // FLAT_OWNERS_ONLY→ RESIDENT only
    // ADMIN_ONLY      → SOCIETY_ADMIN / SUPER_ADMIN / COMMITTEE_MEMBER
    visible_to: {
      type: DataTypes.ENUM("ALL_RESIDENTS", "FLAT_OWNERS_ONLY", "ADMIN_ONLY"),
      defaultValue: "ALL_RESIDENTS",
      allowNull: false,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "documents",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Document;