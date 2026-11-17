"use strict";

/**
 * Migration 20261117000001: Create Independent Amenity Rules & Terms Tables
 * - amenity_rules: Common rules and terms defined per society
 * - amenity_rule_attachments: PDF/Image attachments associated with amenity rules
 * - amenity_booking_terms_acceptances: Immutable audit snapshot of rules accepted per booking
 * - amenity_bookings: Add terms_accepted and terms_accepted_at columns
 */

module.exports = {
  name: "20261117000001-create-amenity-rules-and-acceptances.js",

  async up(conn, isDryRun) {
    console.log("  -> [Amenity Rules] Checking and creating amenity_rules table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS amenity_rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) NOT NULL,
          content TEXT NOT NULL,
          formatted_content MEDIUMTEXT NULL,
          is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          display_order INT NOT NULL DEFAULT 0,
          created_by_user_id INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_amenity_rules_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_amenity_rules_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          INDEX idx_amenity_rules_society_active (society_id, is_active, display_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [Amenity Rules] Checking and creating amenity_rule_attachments table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS amenity_rule_attachments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_id INT NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_url VARCHAR(1000) NOT NULL,
          file_type ENUM('PDF', 'IMAGE') NOT NULL,
          file_size BIGINT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_amenity_rule_attachments_rule FOREIGN KEY (rule_id) REFERENCES amenity_rules(id) ON DELETE CASCADE,
          INDEX idx_amenity_rule_attachments_rule (rule_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [Amenity Rules] Checking and creating amenity_booking_terms_acceptances table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS amenity_booking_terms_acceptances (
          id INT AUTO_INCREMENT PRIMARY KEY,
          booking_id INT NOT NULL UNIQUE,
          amenity_id INT NOT NULL,
          user_id INT NOT NULL,
          society_id INT NOT NULL,
          ruleset_version VARCHAR(64) NOT NULL,
          rules_snapshot JSON NOT NULL,
          user_name_snapshot VARCHAR(255) NOT NULL,
          user_email_snapshot VARCHAR(255) NOT NULL,
          user_role_snapshot VARCHAR(50) NOT NULL,
          ip_address VARCHAR(45) NULL DEFAULT NULL,
          accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_amenity_terms_booking FOREIGN KEY (booking_id) REFERENCES amenity_bookings(id) ON DELETE CASCADE,
          CONSTRAINT fk_amenity_terms_amenity FOREIGN KEY (amenity_id) REFERENCES amenities(id) ON DELETE RESTRICT,
          CONSTRAINT fk_amenity_terms_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
          CONSTRAINT fk_amenity_terms_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT,
          INDEX idx_amenity_terms_booking (booking_id),
          INDEX idx_amenity_terms_user (user_id, society_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [Amenity Rules] Checking and altering amenity_bookings table columns...");
    if (!isDryRun) {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_bookings'"
      );
      const existingCols = new Set(columns.map((col) => col.COLUMN_NAME));

      if (!existingCols.has("terms_accepted")) {
        await conn.query(
          "ALTER TABLE amenity_bookings ADD COLUMN terms_accepted TINYINT(1) NOT NULL DEFAULT 0 AFTER status"
        );
        console.log("     + Added terms_accepted column to amenity_bookings");
      }

      if (!existingCols.has("terms_accepted_at")) {
        await conn.query(
          "ALTER TABLE amenity_bookings ADD COLUMN terms_accepted_at DATETIME NULL DEFAULT NULL AFTER terms_accepted"
        );
        console.log("     + Added terms_accepted_at column to amenity_bookings");
      }
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Amenity Rules Rollback] Rolling back amenity rules tables and columns...");
    if (!isDryRun) {
      await conn.query("DROP TABLE IF EXISTS amenity_booking_terms_acceptances;");
      await conn.query("DROP TABLE IF EXISTS amenity_rule_attachments;");
      await conn.query("DROP TABLE IF EXISTS amenity_rules;");

      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_bookings'"
      );
      const existingCols = new Set(columns.map((col) => col.COLUMN_NAME));

      if (existingCols.has("terms_accepted_at")) {
        await conn.query("ALTER TABLE amenity_bookings DROP COLUMN terms_accepted_at;");
      }
      if (existingCols.has("terms_accepted")) {
        await conn.query("ALTER TABLE amenity_bookings DROP COLUMN terms_accepted;");
      }
    }
  },
};
