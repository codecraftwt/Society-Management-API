const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ExpenseCategory = sequelize.define(
  "ExpenseCategory",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "expense_categories",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_expense_cat_society_name",
        fields: ["society_id", "name"],
      },
      { fields: ["society_id", "status"] },
    ],
  }
);

module.exports = ExpenseCategory;
