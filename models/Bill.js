const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Bill = sequelize.define("Bill", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title : {type : DataTypes.STRING, allowNull: false},
  flat_id: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  billing_month: { type: DataTypes.STRING },
  due_date: { type: DataTypes.DATE },
  status: { type: DataTypes.STRING(50), defaultValue: 'PENDING' },
  // Distinguish generated MAINTENANCE bills from regular BILL records.
  type: { type: DataTypes.STRING(50), defaultValue: 'BILL' },
  // Reference to the MaintenanceRates config that generated this maintenance bill.
  maintenance_rate_id: { type: DataTypes.INTEGER, allowNull: true },
  // Optional snapshot of how the amount was calculated at generation time.
  calculation_details: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: "bills",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Bill;