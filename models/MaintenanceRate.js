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
    flat_type: {
      type: DataTypes.ENUM("1BHK", "2BHK", "3BHK", "ROW_HOUSE", "COMMERCIAL"),
      allowNull: false,
    },
    resident_type: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
  },
  {
    tableName: "MaintenanceRates",
    timestamps: true,
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ["society_id", "flat_type", "resident_type"],
        name: "uq_rate_society_type_role",
      },
    ],
  }
);

module.exports = MaintenanceRate;