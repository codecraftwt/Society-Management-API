const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AmenityBookingTermsAcceptance = sequelize.define(
  "AmenityBookingTermsAcceptance",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    booking_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    amenity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ruleset_version: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    rules_snapshot: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    user_name_snapshot: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    user_email_snapshot: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    user_role_snapshot: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    accepted_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "amenity_booking_terms_acceptances",
    timestamps: false,
    indexes: [
      {
        fields: ["booking_id"],
        unique: true,
        name: "idx_amenity_terms_booking",
      },
      {
        fields: ["user_id", "society_id"],
        name: "idx_amenity_terms_user",
      },
    ],
  }
);

module.exports = AmenityBookingTermsAcceptance;
