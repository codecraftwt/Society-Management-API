/**
 * Comprehensive schema initialization for fresh databases
 * Creates all tables in dependency order
 */
module.exports = {
  name: '000_create_all_tables.js',

  async up(conn, isDryRun) {
    console.log('  -> [000] Creating all tables for fresh database initialization...');
    
    if (isDryRun) {
      console.log('     [DRY RUN] Would create all tables');
      return;
    }

    // 1. societies
    await conn.query(`CREATE TABLE IF NOT EXISTS societies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
      opening_balance_effective_date DATE NULL,
      opening_balance_set_by INT NULL,
      opening_balance_set_at DATETIME NULL,
      primary_color VARCHAR(20) NULL DEFAULT NULL,
      accent_color VARCHAR(20) NULL DEFAULT NULL,
      card_style VARCHAR(50) NULL DEFAULT 'default',
      quick_link_style VARCHAR(50) NULL DEFAULT 'default',
      logo_url VARCHAR(500) NULL DEFAULT NULL,
      logo_public_id VARCHAR(255) NULL DEFAULT NULL,
      theme_updated_by INT NULL DEFAULT NULL,
      theme_updated_at DATETIME NULL DEFAULT NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      location_radius DECIMAL(8,2) NULL DEFAULT 50.00,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    // Users must exist before flats, memberships, and the multi-society
    // migrations can add their foreign keys or backfill existing accounts.
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(255) NULL,
      password VARCHAR(255) NOT NULL,
      role ENUM('SUPER_ADMIN','SOCIETY_ADMIN','COMMITTEE_MEMBER','RESIDENT','FAMILY_MEMBER','GUARD','ACCOUNTANT') NOT NULL,
      roles JSON NOT NULL,
      society_id INT NULL,
      approval_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
      status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
      resident_type ENUM('OWNER','TENANT') NULL,
      fcm_token VARCHAR(255) NULL,
      profile_picture VARCHAR(500) NULL,
      profile_picture_public_id VARCHAR(255) NULL,
      vehicle_count INT NULL DEFAULT 0,
      occupant_count INT NULL DEFAULT 1,
      emergency_contact JSON NULL,
      rejection_reason VARCHAR(255) NULL,
      approved_by_user_id INT NULL,
      approved_by_name VARCHAR(255) NULL,
      approved_by_role VARCHAR(255) NULL,
      approved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_users_society (society_id),
      CONSTRAINT fk_users_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    // 2. blocks
    await conn.query(`CREATE TABLE IF NOT EXISTS blocks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      society_id INT NOT NULL,
      type VARCHAR(255) NOT NULL DEFAULT 'Apartments',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    // 3. floors
    await conn.query(`CREATE TABLE IF NOT EXISTS floors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      floor_number INT NOT NULL,
      block_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    // 4. flats
    await conn.query(`CREATE TABLE IF NOT EXISTS flats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flat_number VARCHAR(255) NOT NULL,
      block_id INT NOT NULL,
      floor_id INT NULL,
      society_id INT NULL,
      resident_id INT NULL,
      flat_type ENUM('1BHK','2BHK','3BHK','ROW_HOUSE','COMMERCIAL') NULL,
      resident_type ENUM('OWNER','TENANT') NULL,
      status ENUM('VACANT','OCCUPIED') DEFAULT 'VACANT',
      area_sqft DECIMAL(10,2) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
      FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    await conn.query(`CREATE TABLE IF NOT EXISTS bills (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      flat_id INT NOT NULL,
      society_id INT NULL,
      amount DECIMAL(10,2) NOT NULL,
      billing_month VARCHAR(255) NULL,
      issue_date DATETIME NULL,
      due_date DATETIME NULL,
      last_pay_date DATETIME NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      type VARCHAR(50) NOT NULL DEFAULT 'BILL',
      bill_category VARCHAR(50) NOT NULL DEFAULT 'OTHER',
      other_bill_type VARCHAR(100) NULL,
      maintenance_rate_id INT NULL,
      calculation_details TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bills_flat (flat_id),
      INDEX idx_bills_society (society_id),
      CONSTRAINT fk_bills_flat FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE CASCADE,
      CONSTRAINT fk_bills_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    await conn.query(`CREATE TABLE IF NOT EXISTS FlatMemberships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flat_id INT NOT NULL,
      user_id INT NOT NULL,
      society_id INT NULL,
      role ENUM('OWNER','TENANT') NOT NULL,
      is_staying TINYINT(1) NOT NULL DEFAULT 1,
      pays_maintenance TINYINT(1) NOT NULL DEFAULT 1,
      move_in_date DATE NULL,
      move_out_date DATE NULL,
      is_current TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_flat_memberships_flat (flat_id),
      INDEX idx_flat_memberships_user (user_id),
      INDEX idx_flat_memberships_society (society_id),
      CONSTRAINT fk_flat_memberships_flat FOREIGN KEY (flat_id) REFERENCES flats(id) ON DELETE CASCADE,
      CONSTRAINT fk_flat_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_flat_memberships_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

    console.log('     Created core tables');
  },

  async down(conn) {
    // Intentionally not dropping tables with data
  }
};
