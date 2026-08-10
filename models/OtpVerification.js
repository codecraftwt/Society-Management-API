const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const OtpVerification = sequelize.define(
  "OtpVerification",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isEmail: true },
    },

    otp_hash: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "bcrypt hash of the 6-digit OTP",
    },

    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "OTP expires 2 minutes after creation",
    },

    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Failed attempt counter — max 5",
    },

    used: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "True once the OTP has been successfully verified",
    },
  },
  {
    tableName: "otp_verifications",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

// Auto-create the table if it doesn't exist — no migration file needed
OtpVerification.sync({ alter: false }).catch((err) =>
  console.error("[OtpVerification] sync error:", err.message)
);

module.exports = OtpVerification;