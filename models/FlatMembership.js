// const { DataTypes } = require("sequelize");
// const sequelize = require("../config/db");

// const FlatMembership = sequelize.define(
//   "FlatMembership",
//   {
//     id: {
//       type: DataTypes.INTEGER,
//       primaryKey: true,
//       autoIncrement: true,
//     },
//     flat_id: {
//       type: DataTypes.INTEGER,
//       allowNull: false,
//       references: { model: "Flats", key: "id" },
//     },
//     user_id: {
//       type: DataTypes.INTEGER,
//       allowNull: false,
//       references: { model: "Users", key: "id" },
//     },
//     role: {
//       type: DataTypes.ENUM("OWNER", "TENANT"),
//       allowNull: false,
//     },
//     is_staying: {
//       type: DataTypes.BOOLEAN,
//       defaultValue: true,
//       comment: "Is this person physically living here?",
//     },
//     pays_maintenance: {
//       type: DataTypes.BOOLEAN,
//       defaultValue: true,
//       comment: "Does this person receive the maintenance bill?",
//     },
//     move_in_date: {
//       type: DataTypes.DATEONLY,
//       allowNull: true,
//     },
//     move_out_date: {
//       type: DataTypes.DATEONLY,
//       allowNull: true,
//       comment: "null = still active",
//     },
//     is_current: {
//       type: DataTypes.BOOLEAN,
//       defaultValue: true,
//     },
//   },
//   {
//     tableName: "FlatMemberships",
//     timestamps: true,
//     underscored: false,
//   }
// );

// module.exports = FlatMembership;


const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FlatMembership = sequelize.define(
  "FlatMembership",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: false,
    },
    is_staying: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: "Is this person physically living here?",
    },
    pays_maintenance: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: "Does this person receive the maintenance bill?",
    },
    move_in_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    move_out_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "null = still active",
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "FlatMemberships",
    timestamps: true,
    underscored: false,
  }
);

module.exports = FlatMembership;