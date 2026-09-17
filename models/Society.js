const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Society = sequelize.define("Society", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.TEXT },
  // Opening balance represents money the society held BEFORE the financial
  // tracking module went live. It is included in computed balances as the
  // CREDIT starting point, never overwritten by day-to-day transactions.
  opening_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  opening_balance_effective_date: { type: DataTypes.DATEONLY, allowNull: true },
  opening_balance_set_by: { type: DataTypes.INTEGER, allowNull: true },
  opening_balance_set_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: "societies",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Society;