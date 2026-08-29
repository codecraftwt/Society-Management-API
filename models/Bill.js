const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Bill = sequelize.define("Bill", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title : {type : DataTypes.STRING, allowNull: false},
  flat_id: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  billing_month: { type: DataTypes.STRING },
  due_date: { type: DataTypes.DATE },
  status: { type: DataTypes.STRING(50), defaultValue: 'PENDING' }
}, {
  tableName: "bills",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Bill;