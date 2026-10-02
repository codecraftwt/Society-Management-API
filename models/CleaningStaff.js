const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * A cleaning staff member hired by a society.
 *
 * Deliberately a standalone table rather than a `User` row: cleaning staff are
 * not app users, they never log in, and they must not appear in resident,
 * tenant, guard or accountant listings. They are society-owned operational data,
 * so `society_id` is mandatory and every read/write must be scoped by it.
 *
 * Rows are never hard-deleted. `status` toggles between ACTIVE/INACTIVE so the
 * historical pass and attendance rows that reference this record stay meaningful.
 */
const CleaningStaff = sequelize.define(
  "CleaningStaff",
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

    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    phone: {
      type: DataTypes.STRING(15),
      allowNull: true,
    },

    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    /* Free-form home address / locality the staff member is reachable at. */
    address: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    profile_picture: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    profile_picture_public_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    /* Role within the cleaning team, e.g. "Head Cleaner", "Maaid". */
    designation: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    joining_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "cleaning_staff",
    timestamps: true,
    // Follow the project convention (see Document.js) so controllers can
    // order by created_at / updated_at rather than the Sequelize camelCase.
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "idx_cleaning_staff_society", fields: ["society_id"] },
      { name: "idx_cleaning_staff_society_status", fields: ["society_id", "status"] },
    ],
  }
);

module.exports = CleaningStaff;