"use strict";

/**
 * Migration 20261116000001: Create Society-Wise Rules & Regulations Tables
 * - rules: Core rule definitions per society
 * - rule_versions: Versioned documents with PDF URLs and snapshot settings
 * - rule_acknowledgements: User acknowledgements with user snapshots for audit retention
 */

module.exports = {
  name: "20261116000001-create-rules-tables.js",

  async up(conn, isDryRun) {
    console.log("  -> [Rules] Checking and creating rules table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) NOT NULL,
          description TEXT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_rules_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          INDEX idx_rules_society_active (society_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [Rules] Checking and creating rule_versions table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS rule_versions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_id INT NOT NULL,
          society_id INT NOT NULL,
          version_number INT NOT NULL,
          file_url VARCHAR(1000) NOT NULL,
          document_name VARCHAR(255) NOT NULL,
          change_summary TEXT NULL,
          is_mandatory TINYINT(1) NOT NULL DEFAULT 0,
          is_current TINYINT(1) NOT NULL DEFAULT 1,
          current_flag TINYINT GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN 1 ELSE NULL END) STORED,
          published_by_user_id INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_rule_versions_rule FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE RESTRICT,
          CONSTRAINT fk_rule_versions_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_rule_versions_publisher FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_rule_version (rule_id, version_number),
          UNIQUE KEY uq_rule_current (rule_id, current_flag),
          INDEX idx_rule_versions_society_current (society_id, is_current, is_mandatory)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [Rules] Checking and creating rule_acknowledgements table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS rule_acknowledgements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_id INT NOT NULL,
          rule_version_id INT NOT NULL,
          user_id INT NULL DEFAULT NULL,
          user_name_snapshot VARCHAR(255) NOT NULL,
          user_email_snapshot VARCHAR(255) NOT NULL,
          society_id INT NOT NULL,
          source ENUM('REGISTRATION', 'LOGIN_GATE', 'PORTAL') NOT NULL DEFAULT 'PORTAL',
          acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_rule_ack_rule FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE RESTRICT,
          CONSTRAINT fk_rule_ack_version FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id) ON DELETE RESTRICT,
          CONSTRAINT fk_rule_ack_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_rule_ack_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT,
          UNIQUE KEY uq_user_rule_version_society (rule_version_id, user_id, society_id),
          INDEX idx_rule_ack_user_society (user_id, society_id),
          INDEX idx_rule_ack_version (rule_version_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },

  async down(conn) {
    throw new Error("Destructive rollback is disabled for production safety. Restore a backup or use a reviewed recovery migration.");
  },
};
