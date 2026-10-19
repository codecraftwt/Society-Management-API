/**
 * Migration 001: Create Multi-Society Membership & Invite Tables and Add Scoping Columns
 */

module.exports = {
  name: "001_create_multisociety_tables.js",

  async up(conn, isDryRun) {
    console.log("  -> [001] Checking and creating user_societies table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_societies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          society_id INT NOT NULL,
          membership_status ENUM('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
          is_default TINYINT(1) NOT NULL DEFAULT 0,
          resident_type ENUM('OWNER', 'TENANT') NULL DEFAULT NULL,
          occupant_count INT NULL DEFAULT 1,
          vehicle_count INT NULL DEFAULT 0,
          emergency_contact JSON NULL DEFAULT NULL,
          source VARCHAR(50) NOT NULL DEFAULT 'MIGRATED',
          invited_by_user_id INT NULL DEFAULT NULL,
          approved_by_user_id INT NULL DEFAULT NULL,
          joined_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_society (user_id, society_id),
          INDEX idx_user_societies_user (user_id),
          INDEX idx_user_societies_society (society_id),
          INDEX idx_user_societies_status (membership_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [001] Checking and creating user_society_roles table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_society_roles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_society_id INT NOT NULL,
          role VARCHAR(50) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_society_role (user_society_id, role),
          INDEX idx_usr_user_society (user_society_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    console.log("  -> [001] Checking and creating society_invites table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS society_invites (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          code VARCHAR(64) NOT NULL UNIQUE,
          role_hint VARCHAR(50) NULL DEFAULT 'RESIDENT',
          max_uses INT NOT NULL DEFAULT 1,
          uses INT NOT NULL DEFAULT 0,
          expires_at DATETIME NOT NULL,
          created_by_user_id INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_society_invites_soc (society_id),
          INDEX idx_society_invites_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    // Additive column: bills.society_id
    console.log("  -> [001] Checking bills.society_id column...");
    const [billCols] = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'society_id'"
    );
    if (billCols.length === 0) {
      console.log("     Adding bills.society_id column...");
      if (!isDryRun) {
        await conn.query(`
          ALTER TABLE bills 
          ADD COLUMN society_id INT NULL DEFAULT NULL AFTER flat_id,
          ADD INDEX idx_bills_society_id (society_id);
        `);
      }
    } else {
      console.log("     bills.society_id already exists.");
    }

    // Additive column: FlatMemberships.society_id
    console.log("  -> [001] Checking FlatMemberships.society_id column...");
    const [flatMemCols] = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FlatMemberships' AND COLUMN_NAME = 'society_id'"
    );
    if (flatMemCols.length === 0) {
      console.log("     Adding FlatMemberships.society_id column...");
      if (!isDryRun) {
        await conn.query(`
          ALTER TABLE FlatMemberships 
          ADD COLUMN society_id INT NULL DEFAULT NULL AFTER user_id,
          ADD INDEX idx_flat_memberships_society_id (society_id);
        `);
      }
    } else {
      console.log("     FlatMemberships.society_id already exists.");
    }
  },

  async down(conn) {
    await conn.query("DROP TABLE IF EXISTS user_society_roles");
    await conn.query("DROP TABLE IF EXISTS user_societies");
    await conn.query("DROP TABLE IF EXISTS society_invites");
  },
};
