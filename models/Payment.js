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
    resident_id: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.DECIMAL(10, 2) },
    payment_mode: { type: DataTypes.STRING },
    payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // Distinguishes the financial stream: BILL, MAINTENANCE (maintenance bills)
    // or AMENITY (amenity booking payments).
    source: { type: DataTypes.ENUM("BILL", "MAINTENANCE", "AMENITY"), defaultValue: "BILL" },
    // Business state: PENDING after resident submits demo payment, SUCCESS only
    // after admin/accountant confirmation (bills) or instant amenity verification.
    // Reports only count SUCCESS payments as realised income.
    status: { type: DataTypes.ENUM("PENDING", "SUCCESS", "FAILED", "CANCELLED"), defaultValue: "PENDING" }
  },
  {
    timestamps: false
  }
);

module.exports = Payment;