const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Payment = sequelize.define(
  "Payment",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bill_id: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2) },
    payment_mode: { type: DataTypes.STRING },
    payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  },
  {
    timestamps: false   // ✅ ADD THIS LINE
  }
);

module.exports = Payment;