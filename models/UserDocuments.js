const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // adjust path if needed

const UserDocuments = sequelize.define(
  "UserDocuments",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // 🔥 one user → one document record
    },

    aadhar_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    aadhar_public_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    pan_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    pan_public_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "user_documents",
    timestamps: true, // createdAt, updatedAt
  }
);

module.exports = UserDocuments;