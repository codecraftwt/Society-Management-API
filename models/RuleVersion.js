const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RuleVersion = sequelize.define(
  "RuleVersion",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    rule_id: { type: DataTypes.INTEGER, allowNull: false },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    version_number: { type: DataTypes.INTEGER, allowNull: false },
    file_url: { type: DataTypes.STRING(1000), allowNull: false },
    document_name: { type: DataTypes.STRING(255), allowNull: false },
    change_summary: { type: DataTypes.TEXT, allowNull: true },
    is_mandatory: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    current_flag: {
      type: DataTypes.TINYINT,
      allowNull: true,
      // Generated column in MySQL: do not insert or update directly
    },
    published_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "rule_versions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = RuleVersion;

