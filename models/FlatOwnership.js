const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * FlatOwnership — junction table for the many-to-many relationship
 * between Users (residents) and Flats.
 *
 * One resident can own/rent multiple flats.
 * One flat can only have one CURRENT resident (enforced via is_current).
 *
 * Replaces the old `resident_id` column approach (kept for legacy compat).
 */
const FlatOwnership = sequelize.define(
  "FlatOwnership",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // OWNER or TENANT — per flat, not per user
    resident_type: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: true,
      defaultValue: null,
    },

    // 1BHK / 2BHK / 3BHK — can be different per flat
    flat_type: {
      type: DataTypes.ENUM("1BHK", "2BHK", "3BHK"),
      allowNull: true,
      defaultValue: null,
    },

    // true = this is the resident's "primary" flat (used for billing defaults,
    // committee eligibility checks, neighbour directory, etc.)
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // Still active, or has this resident moved out of this flat?
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    move_in_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },

    move_out_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "flat_ownerships",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      // A flat can only have one CURRENT resident
      {
        unique: true,
        fields: ["flat_id"],
        where: { is_current: true },
        name: "flat_ownerships_flat_id_unique_current",
      },
    ],
  }
);

module.exports = FlatOwnership;