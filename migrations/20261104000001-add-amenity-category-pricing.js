"use strict";

module.exports = {
  async up(conn) {
    const [amenityColumns] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenities'");
    const existing = new Set(amenityColumns.map((c) => c.COLUMN_NAME));
    for (const [name, definition] of [["resident_rate_per_hour", "DECIMAL(10,2) NOT NULL DEFAULT 0"], ["tenant_rate_per_hour", "DECIMAL(10,2) NOT NULL DEFAULT 0"]]) {
      if (!existing.has(name)) await conn.query(`ALTER TABLE amenities ADD COLUMN ${name} ${definition}`);
    }
    await conn.query("UPDATE amenities SET resident_rate_per_hour = rate_per_hour, tenant_rate_per_hour = rate_per_hour WHERE type = 'PAID' AND resident_rate_per_hour = 0 AND tenant_rate_per_hour = 0");

    const [bookingColumns] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_bookings'");
    const bookingExisting = new Set(bookingColumns.map((c) => c.COLUMN_NAME));
    for (const [name, definition] of [["occupancy_category", "VARCHAR(20) NULL"], ["rate_per_hour_snapshot", "DECIMAL(10,2) NULL"], ["amount", "DECIMAL(10,2) NULL"]]) {
      if (!bookingExisting.has(name)) await conn.query(`ALTER TABLE amenity_bookings ADD COLUMN ${name} ${definition}`);
    }
  },
};
