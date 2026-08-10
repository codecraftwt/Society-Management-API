const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GuardShift = sequelize.define("GuardShift",{

  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  guard_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  society_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  shift_type: {
    type: DataTypes.ENUM("MORNING", "AFTERNOON", "NIGHT"),
    allowNull: false
  },

  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },

  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  }

}, {
  tableName: "guard_shifts",
  timestamps: true
});

module.exports = GuardShift;


