


const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AmenityBooking = sequelize.define(
  "AmenityBooking",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    society_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    amenity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    flat_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    start_time: {
      type: DataTypes.TIME,
      allowNull: true,
    },

    end_time: {
      type: DataTypes.TIME,
      allowNull: true,
    },

    /*
     * Status lifecycle:
     *
     * PAID amenity, no approval:
     *   PAYMENT_PENDING → APPROVED  (on payment success)
     *   PAYMENT_PENDING → CANCELLED (on expiry / user abandons)
     *
     * PAID amenity, requires_approval:
     *   PAYMENT_PENDING → PENDING   (on payment success, admin must approve)
     *   PAYMENT_PENDING → CANCELLED (expiry)
     *   PENDING         → APPROVED / REJECTED (admin action)
     *
     * FREE amenity, no approval:
     *   [created as] APPROVED
     *
     * FREE amenity, requires_approval:
     *   [created as] PENDING → APPROVED / REJECTED (admin action)
     */
    status: {
      type: DataTypes.ENUM(
        "PAYMENT_PENDING", // slot held, awaiting payment confirmation
        "PENDING",         // payment done (or FREE), awaiting admin approval
        "APPROVED",        // confirmed & usable
        "REJECTED",        // admin rejected
        "CANCELLED",       // user-cancelled or payment-expired
        "COMPLETED"        // post-use state (optional)
      ),
      defaultValue: "APPROVED",
    },

    payment_status: {
      type: DataTypes.ENUM("PENDING", "PAID", "FAILED", "NA"),
      defaultValue: "NA",
    },

    /* Razorpay integration fields */
    razorpay_order_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null,
    },

    razorpay_payment_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null,
    },

    /*
     * For PAID bookings: the booking is auto-cancelled if payment is not
     * confirmed by this timestamp.  Set to NOW + 15 minutes at creation.
     */
    payment_expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    timestamps: true,
    tableName: "amenity_bookings",
    indexes: [
      { fields: ["amenity_id", "date"] },
      { fields: ["user_id"] },
      { fields: ["status", "payment_expires_at"], name: "idx_bookings_payment_expiry" },
    ],
  }
);

module.exports = AmenityBooking;