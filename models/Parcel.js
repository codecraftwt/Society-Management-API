const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Parcel = sequelize.define("Parcel", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  resident_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // Can be null if guard enters it manually without selecting resident initially (optional flow)
  },
  flat_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  society_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  guard_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // Guard who accepted/logged it
  },
  courier_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("EXPECTED", "AT_GATE", "COLLECTED","CANCELLED"),
    defaultValue: "AT_GATE",
  },
  entry_time: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  pickup_code: {
    type: DataTypes.STRING, // Optional: 4-digit code for security
    allowNull: true,
  },
  image: {
    type: DataTypes.STRING, // URL to parcel image
    allowNull: true,
  }
}, {
  timestamps: true,
  tableName: "parcels"
});

module.exports = Parcel;