"use strict";

module.exports = {
  name: "20261125000001-create-society-financial-accounts.js",

  async up(conn, isDryRun) {
    console.log("  -> [Accounting] Creating society_financial_accounts table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS society_financial_accounts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          account_name VARCHAR(120) NOT NULL,
          account_type ENUM('SAVINGS', 'CURRENT', 'CASH', 'OTHER') NOT NULL DEFAULT 'SAVINGS',
          bank_name VARCHAR(120) NULL DEFAULT NULL,
          account_holder_name VARCHAR(150) NULL DEFAULT NULL,
          account_number VARCHAR(50) NULL DEFAULT NULL,
          ifsc_code VARCHAR(20) NULL DEFAULT NULL,
          branch_name VARCHAR(120) NULL DEFAULT NULL,
          opening_balance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          opening_balance_date DATE NULL DEFAULT NULL,
          current_balance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          is_default TINYINT(1) NOT NULL DEFAULT 0,
          status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
          created_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_fin_acc_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_fin_acc_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_fin_acc_society_number (society_id, account_number),
          INDEX idx_fin_acc_society_status (society_id, status),
          INDEX idx_fin_acc_society_type (society_id, account_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },

  async down(conn, isDryRun) {
    if (!isDryRun) {
      await conn.query("DROP TABLE IF EXISTS society_financial_accounts;");
    }
  },
};
