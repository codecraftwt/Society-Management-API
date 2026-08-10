

'use strict';

/**
 * Migration: Add PAYMENT_PENDING booking status + payment tracking fields
 *
 * Why:
 *  - "PAYMENT_PENDING" = booking reserved but payment not yet confirmed.
 *    This prevents a slot from being double-booked while a user is on the
 *    payment page, and gives us a clean state to show a "Repay" button.
 *  - razorpay_order_id  — the Razorpay order we create before redirecting.
 *  - razorpay_payment_id — populated by the webhook after capture.
 *  - payment_expires_at  — if payment is not confirmed by this time, a
 *    cron job marks the booking CANCELLED and frees the slot.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add new columns
    await queryInterface.addColumn("amenity_bookings", "razorpay_order_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
      defaultValue: null,
      after: "payment_status",
    });

    await queryInterface.addColumn("amenity_bookings", "razorpay_payment_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
      defaultValue: null,
      after: "razorpay_order_id",
    });

    await queryInterface.addColumn("amenity_bookings", "payment_expires_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      after: "razorpay_payment_id",
    });

    // 2. Add PAYMENT_PENDING to the status ENUM.
    //    MySQL requires a direct ALTER TABLE to change ENUM values.
    await queryInterface.sequelize.query(`
      ALTER TABLE amenity_bookings
      MODIFY COLUMN status ENUM(
        'PAYMENT_PENDING',
        'PENDING',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'COMPLETED'
      ) NOT NULL DEFAULT 'APPROVED'
    `);

    // 3. Index for the expiry cron — only scans rows that need attention
    await queryInterface.addIndex("amenity_bookings", ["status", "payment_expires_at"], {
      name: "idx_bookings_payment_expiry",
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex("amenity_bookings", "idx_bookings_payment_expiry");
    await queryInterface.removeColumn("amenity_bookings", "payment_expires_at");
    await queryInterface.removeColumn("amenity_bookings", "razorpay_payment_id");
    await queryInterface.removeColumn("amenity_bookings", "razorpay_order_id");

    await queryInterface.sequelize.query(`
      ALTER TABLE amenity_bookings
      MODIFY COLUMN status ENUM(
        'PENDING',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'COMPLETED'
      ) NOT NULL DEFAULT 'APPROVED'
    `);
  },
};