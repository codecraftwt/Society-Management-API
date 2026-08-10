
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// const Vehicle = sequelize.define("Vehicle", {

//   id: {
//     type: DataTypes.INTEGER,
//     autoIncrement: true,
//     primaryKey: true
//   },

//   vehicle_number: {
//     type: DataTypes.STRING,
//     allowNull: false
//   },

//   vehicle_type: {
//     type: DataTypes.ENUM("BIKE", "CAR", "OTHER"),
//     allowNull: false
//   },

//   resident_id: {
//     type: DataTypes.INTEGER,
//     allowNull: false
//   },

//   flat_id: {
//     type: DataTypes.INTEGER,
//     allowNull: false
//   },

//   society_id: {
//     type: DataTypes.INTEGER,
//     allowNull: false
//   },

//   vehicle_name: {
//     type: DataTypes.STRING,
//     allowNull: false
//   },

//   parking_slot_id: {
//     type: DataTypes.INTEGER,
//     allowNull: true,          // ✅ FIXED: was false — vehicles without slots are valid
//   },

//   parking_type: {
//     type: DataTypes.ENUM("DEFAULT", "EXTRA"),
//     defaultValue: "DEFAULT",
//     allowNull: false,
//     // DEFAULT = vehicle uses the flat's pre-assigned slot
//     // EXTRA   = vehicle needs an admin-assigned extra slot (overflow / 3rd+ car)
//   }

// }, {
//   tableName: "vehicles",
//   timestamps: true
// });

// module.exports = Vehicle;

const Vehicle = sequelize.define("Vehicle", {
  id:             { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  vehicle_number: { type: DataTypes.STRING,  allowNull: false },
  vehicle_type:   { type: DataTypes.ENUM("BIKE", "CAR", "OTHER"), allowNull: false },
  resident_id:    { type: DataTypes.INTEGER, allowNull: false },
  flat_id:        { type: DataTypes.INTEGER, allowNull: false },
  society_id:     { type: DataTypes.INTEGER, allowNull: false },
  vehicle_name:   { type: DataTypes.STRING,  allowNull: false },
  parking_slot_id:{ type: DataTypes.INTEGER, allowNull: true },
  // ✅ REMOVED: parking_type — it belongs to ParkingSlot, not Vehicle
}, { tableName: "vehicles", timestamps: true });

 module.exports = Vehicle;