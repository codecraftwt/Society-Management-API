const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MaintenanceRate = sequelize.define(
  "MaintenanceRate",
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
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    maintenance_type: {
      // LUMPSUM | SQ_FEET | FLAT
      type: DataTypes.ENUM("LUMPSUM", "SQ_FEET", "FLAT"),
      allowNull: false,
    },
    // FLAT-type configs use flat_type; LUMPSUM/SQ_FEET keep it NULL.
    flat_type: {
      type: DataTypes.ENUM("1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL"),
      allowNull: true,
      defaultValue: null,
    },
    resident_type: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: true,
      defaultValue: null,
    },
    // LUMPSUM / FLAT use amount; SQ_FEET uses rate_per_sqft.
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
    rate_per_sqft: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
    frequency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "MONTHLY",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "MaintenanceRates",
    timestamps: true,
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ["society_id", "maintenance_type", "flat_type", "resident_type"],
        name: "uq_rate_society_type",
      },
    ],
  }
);

module.exports = MaintenanceRate;
