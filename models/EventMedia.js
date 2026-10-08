const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const EventMedia = sequelize.define(
  "EventMedia",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    event_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    media_type: {
      type: DataTypes.ENUM("IMAGE", "VIDEO"),
      allowNull: false,
      defaultValue: "IMAGE",
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    public_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    thumb_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    original_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    size_bytes: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "event_media",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = EventMedia;
