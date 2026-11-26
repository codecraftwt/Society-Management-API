const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Payment = sequelize.define(
  "Payment",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // Money-IN unit. bill_id is set for BILL / MAINTENANCE payments,
    // amenity_booking_id is set for AMENITY payments (one payment per booking row).
    bill_id: { type: DataTypes.INTEGER, allowNull: true },
    amenity_booking_id: { type: DataTypes.INTEGER, allowNull: true },
    society_id: { type: DataTypes.INTEGER, allowNull: true },
    financial_account_id: { type: DataTypes.INTEGER, allowNull: true },
    resident_id: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.DECIMAL(10, 2) },
    base_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: null },
    late_fee_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: 0.0 },
    waived_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: 0.0 },
    payment_mode: { type: DataTypes.STRING },
    payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    razorpay_order_id: { type: DataTypes.STRING(64), allowNull: true },
    razorpay_payment_id: { type: DataTypes.STRING(64), allowNull: true },
    transaction_ref: { type: DataTypes.STRING(120), allowNull: true },
    confirmed_by: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_at: { type: DataTypes.DATE, allowNull: true },
    // Distinguishes the financial stream: BILL, MAINTENANCE (maintenance bills)
    // or AMENITY (amenity booking payments).
    source: { type: DataTypes.ENUM("BILL", "MAINTENANCE", "AMENITY"), defaultValue: "BILL" },
    // Business state: INITIATED when order/UPI created, PENDING after resident submits payment,
    // SUCCESS only after admin/accountant confirmation (or instant amenity hold confirmation).
    // Reports only count SUCCESS payments as realised income.
    status: { type: DataTypes.ENUM("INITIATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED"), defaultValue: "PENDING" }
  },
  {
    timestamps: false
  }
);

module.exports = Payment;