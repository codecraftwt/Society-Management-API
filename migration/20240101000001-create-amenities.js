
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("amenities", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },

      society_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      name: {
        type: Sequelize.STRING,
        allowNull: false
      },

      icon: {
        type: Sequelize.STRING,
        defaultValue: "apartment"
      },

      type: {
        type: Sequelize.ENUM("FREE", "PAID"),
        defaultValue: "FREE"
      },

      booking_type: {
        type: Sequelize.ENUM("SLOT", "FULL_DAY"),
        defaultValue: "SLOT"
      },

      rate_per_hour: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.0
      },

      // Allow null for FULL_DAY
      opening_time: {
        type: Sequelize.TIME,
        allowNull: true
      },

      closing_time: {
        type: Sequelize.TIME,
        allowNull: true
      },

      slot_duration: {
        type: Sequelize.INTEGER,
        defaultValue: 60
      },

      capacity: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },

      requires_approval: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },

      // ── Disable / closure fields ──
      disable_type: {
        type: Sequelize.ENUM("TEMPORARY", "PERMANENT"),
        allowNull: true,
        defaultValue: null
      },

      disabled_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
      },

      disabled_from: {
        type: Sequelize.DATEONLY,
        allowNull: true,
        defaultValue: null
      },

      disabled_until: {
        type: Sequelize.DATEONLY,
        allowNull: true,
        defaultValue: null
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("amenities");
  },
};