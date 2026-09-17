const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const EmergencyAcknowledgement = sequelize.define(
  "EmergencyAcknowledgement",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    emergency_alert_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    viewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "emergency_acknowledgements",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["emergency_alert_id", "user_id"],
      },
      {
        fields: ["emergency_alert_id"],
      },
      {
        fields: ["user_id"],
      },
      {
        fields: ["emergency_alert_id", "read_at"],
      },
    ],
  }
);

module.exports = EmergencyAcknowledgement;
