"use strict";

/**
 * Migration 20261126000001: Create Meeting Minutes (MOM) Tables
 * - meeting_categories: Society-scoped configurable meeting categories
 * - meeting_minutes: Meeting details, agenda, minutes, decisions (soft-deletable)
 * - meeting_attendees: Present/Absent attendance with historical member snapshots
 */

module.exports = {
  name: "20261126000001-create-meeting-minutes-tables.js",

  async up(conn, isDryRun) {
    console.log("  -> [MOM] Creating meeting_categories table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS meeting_categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(255) NULL DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_meeting_cat_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_meeting_cat_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_meeting_cat_society_name (society_id, name),
          INDEX idx_meeting_cat_society_active (society_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [MOM] Creating meeting_minutes table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS meeting_minutes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          category_id INT NOT NULL,
          meeting_title VARCHAR(255) NOT NULL,
          meeting_date DATE NOT NULL,
          agenda TEXT NOT NULL,
          minutes LONGTEXT NOT NULL,
          decisions TEXT NULL DEFAULT NULL,
          created_by INT NULL DEFAULT NULL,
          updated_by INT NULL DEFAULT NULL,
          deleted_at DATETIME NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_mom_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_mom_category FOREIGN KEY (category_id) REFERENCES meeting_categories(id) ON DELETE RESTRICT,
          CONSTRAINT fk_mom_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_mom_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
          INDEX idx_mom_society_date (society_id, meeting_date),
          INDEX idx_mom_society_category (society_id, category_id),
          INDEX idx_mom_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [MOM] Creating meeting_attendees table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS meeting_attendees (
          id INT AUTO_INCREMENT PRIMARY KEY,
          meeting_id INT NOT NULL,
          society_id INT NOT NULL,
          user_id INT NULL DEFAULT NULL,
          attendance_status ENUM('PRESENT', 'ABSENT') NOT NULL DEFAULT 'ABSENT',
          member_name_snapshot VARCHAR(255) NOT NULL,
          member_role_snapshot VARCHAR(100) NULL DEFAULT NULL,
          flat_info_snapshot VARCHAR(255) NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_attendee_meeting FOREIGN KEY (meeting_id) REFERENCES meeting_minutes(id) ON DELETE CASCADE,
          CONSTRAINT fk_attendee_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_attendee_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_meeting_attendee (meeting_id, user_id),
          INDEX idx_attendee_meeting_status (meeting_id, attendance_status),
          INDEX idx_attendee_society_user (society_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },

  async down(conn, isDryRun) {
    if (!isDryRun) {
      await conn.query("DROP TABLE IF EXISTS meeting_attendees;");
      await conn.query("DROP TABLE IF EXISTS meeting_minutes;");
      await conn.query("DROP TABLE IF EXISTS meeting_categories;");
    }
  },
};
