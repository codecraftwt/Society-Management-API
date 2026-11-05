"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("amenities", "resident_rate_per_hour", { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn("amenities", "tenant_rate_per_hour", { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn("amenity_bookings", "occupancy_category", { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn("amenity_bookings", "rate_per_hour_snapshot", { type: Sequelize.DECIMAL(10, 2), allowNull: true });
    await queryInterface.addColumn("amenity_bookings", "amount", { type: Sequelize.DECIMAL(10, 2), allowNull: true });
    await queryInterface.sequelize.query("UPDATE amenities SET resident_rate_per_hour = rate_per_hour, tenant_rate_per_hour = rate_per_hour WHERE type = 'PAID'");
  },
  async down(queryInterface) {
    for (const [table, column] of [["amenities", "resident_rate_per_hour"], ["amenities", "tenant_rate_per_hour"], ["amenity_bookings", "occupancy_category"], ["amenity_bookings", "rate_per_hour_snapshot"], ["amenity_bookings", "amount"]]) await queryInterface.removeColumn(table, column);
  },
};
