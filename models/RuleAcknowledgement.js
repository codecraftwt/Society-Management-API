const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RuleAcknowledgement = sequelize.define(
  "RuleAcknowledgement",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    rule_id: { type: DataTypes.INTEGER, allowNull: false },
    rule_version_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: true },
    user_name_snapshot: { type: DataTypes.STRING(255), allowNull: false },
    user_email_snapshot: { type: DataTypes.STRING(255), allowNull: false },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    source: {
      type: DataTypes.ENUM("REGISTRATION", "LOGIN_GATE", "PORTAL"),
      allowNull: false,
      defaultValue: "PORTAL",
    },
    acknowledged_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "rule_acknowledgements",
    timestamps: false,
  }
);

module.exports = RuleAcknowledgement;

