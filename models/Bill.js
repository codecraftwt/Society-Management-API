const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Bill = sequelize.define("Bill", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title : {type : DataTypes.STRING, allowNull: false},
  flat_id: { type: DataTypes.INTEGER, allowNull: false },
  society_id: { type: DataTypes.INTEGER, allowNull: true },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  billing_month: { type: DataTypes.STRING },
  issue_date: { type: DataTypes.DATE },
  due_date: { type: DataTypes.DATE },
  last_pay_date: { type: DataTypes.DATE },
  status: { type: DataTypes.STRING(50), defaultValue: 'PENDING' },
  // Distinguish generated MAINTENANCE bills from regular BILL records.
  type: { type: DataTypes.STRING(50), defaultValue: 'BILL' },
  // Category of bill: ELECTRICITY, WATER, GAS, PARKING, SECURITY, AMENITIES, OTHER
  bill_category: { 
    type: DataTypes.STRING(50), 
    defaultValue: 'OTHER' 
  },
  // Custom description when bill_category is OTHER
  other_bill_type: { 
    type: DataTypes.STRING(100), 
    allowNull: true 
  },
  // Reference to the MaintenanceRates config that generated this maintenance bill.
  maintenance_rate_id: { type: DataTypes.INTEGER, allowNull: true },
  // Snapshot of the collection bank account assigned at bill generation/initiation.
  financial_account_id: { type: DataTypes.INTEGER, allowNull: true },
  // Optional snapshot of how the amount was calculated at generation time.
  calculation_details: { type: DataTypes.TEXT, allowNull: true },
  // Late fee policy snapshot captured at bill generation time.
  late_fee_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  late_fee_type: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
  late_fee_value: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: null },
  late_fee_grace_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  late_fee_max_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: null },
}, {
  tableName: "bills",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Bill;