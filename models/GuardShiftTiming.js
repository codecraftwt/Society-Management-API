const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GuardShiftTiming = sequelize.define(
  "GuardShiftTiming",
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

    shift_type: {
      type: DataTypes.ENUM("MORNING", "AFTERNOON", "NIGHT"),
      allowNull: false,
    },

    /* 24h "HH:mm" society-level windows. GuardShift = assignment;
       GuardShiftTiming = society configuration. */
    start_time: {
      type: DataTypes.STRING(5),
      allowNull: false,
      validate: { is: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },

    end_time: {
      type: DataTypes.STRING(5),
      allowNull: false,
      validate: { is: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },
  },
  {
    tableName: "guard_shift_timings",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["society_id", "shift_type"],
      },
    ],
  }
);

module.exports = GuardShiftTiming;