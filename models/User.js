
// const { DataTypes } = require("sequelize");
// const sequelize = require("../config/db");

// const User = sequelize.define(
//   "User",
//   {
//     id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

//     name: { type: DataTypes.STRING, allowNull: false },

//     email: {
//       type: DataTypes.STRING,
//       allowNull: false,
//       unique: true,
//       validate: { isEmail: true },
//     },

//     phone: { type: DataTypes.STRING },

//     password: { type: DataTypes.STRING, allowNull: false },

//     // 🔥 OLD FIELD (keep for backward compatibility)
//     role: {
//       type: DataTypes.ENUM(
//         "SUPER_ADMIN",
//         "SOCIETY_ADMIN",
//         "COMMITTEE_MEMBER",
//         "RESIDENT",
//         "FAMILY_MEMBER",
//         "GUARD",
//         "ACCOUNTANT"
//       ),
//       allowNull: false,
//     },

//     // 🔥 NEW FIELD (multi-role support)
//     roles: {
//       type: DataTypes.JSON,
//       allowNull: false,
//       defaultValue: [],
//     },

//     society_id: { type: DataTypes.INTEGER, allowNull: true },

//     approval_status: {
//       type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
//       defaultValue: "PENDING",
//     },

//     status: {
//       type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
//       defaultValue: "ACTIVE",
//     },

//     resident_type: {
//       type: DataTypes.ENUM("OWNER", "TENANT"),
//       allowNull: true,
//       defaultValue: null,
//     },

//     // 🔔 Push Notification Token
//     fcm_token: {
//       type: DataTypes.STRING,
//       allowNull: true,
//     },
//   },
//   {
//     tableName: "users",
//     timestamps: true,
//     createdAt: "created_at",
//     updatedAt: false,
//   }
// );

// module.exports = User;



const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    name: { type: DataTypes.STRING, allowNull: false },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    phone: { type: DataTypes.STRING },

    password: { type: DataTypes.STRING, allowNull: false },

    // 🔥 OLD FIELD (keep for backward compatibility)
    role: {
      type: DataTypes.ENUM(
        "SUPER_ADMIN",
        "SOCIETY_ADMIN",
        "COMMITTEE_MEMBER",
        "RESIDENT",
        "FAMILY_MEMBER",
        "GUARD",
        "ACCOUNTANT"
      ),
      allowNull: false,
    },

    // 🔥 NEW FIELD (multi-role support)
    roles: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },

    society_id: { type: DataTypes.INTEGER, allowNull: true },

    approval_status: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
      defaultValue: "PENDING",
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      defaultValue: "ACTIVE",
    },

    resident_type: {
      type: DataTypes.ENUM("OWNER", "TENANT"),
      allowNull: true,
      defaultValue: null,
    },

    // 🔔 Push Notification Token
    fcm_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // 🚗 Number of vehicles owned by the resident
    vehicle_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      validate: { min: 0, max: 10 },
    },

    // 👥 Number of people living in the flat
    occupant_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
      validate: { min: 1, max: 50 },
    },

    // 🆘 Emergency contact (name + phone stored as JSON: { name, phone })
    emergency_contact: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    rejection_reason: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "users",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = User;