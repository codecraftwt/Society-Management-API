"use strict";

module.exports = {
  name: "20261125000003-create-fixed-deposits-and-transactions.js",

  async up(conn, isDryRun) {
    console.log("  -> [Accounting] Creating fixed_deposits & fd_transactions tables...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS fixed_deposits (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          fd_type ENUM('EXISTING', 'NEW') NOT NULL DEFAULT 'NEW',
          funding_source ENUM('BANK', 'CASH') NULL DEFAULT NULL,
          funding_account_id INT NULL DEFAULT NULL,
          fd_number VARCHAR(80) NOT NULL,
          bank_name VARCHAR(120) NOT NULL,
          principal_amount DECIMAL(14, 2) NOT NULL,
          interest_rate DECIMAL(5, 2) NOT NULL,
          start_date DATE NOT NULL,
          maturity_date DATE NOT NULL,
          expected_maturity_amount DECIMAL(14, 2) NOT NULL,
          total_interest_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          principal_returned DECIMAL(14, 2) NULL DEFAULT NULL,
          final_interest_received DECIMAL(14, 2) NULL DEFAULT NULL,
          total_interest_earned DECIMAL(14, 2) NULL DEFAULT NULL,
          loss_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          actual_received_amount DECIMAL(14, 2) NULL DEFAULT NULL,
          interest_payout_type ENUM('CUMULATIVE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'ON_MATURITY') NOT NULL DEFAULT 'ON_MATURITY',
          receiving_account_id INT NULL DEFAULT NULL,
          status ENUM('ACTIVE', 'MATURED', 'CLOSED', 'PREMATURE_CLOSED') NOT NULL DEFAULT 'ACTIVE',
          closed_date DATE NULL DEFAULT NULL,
          remarks TEXT NULL DEFAULT NULL,
          created_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_fd_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_fd_funding_acc FOREIGN KEY (funding_account_id) REFERENCES society_financial_accounts(id) ON DELETE SET NULL,
          CONSTRAINT fk_fd_receiving_acc FOREIGN KEY (receiving_account_id) REFERENCES society_financial_accounts(id) ON DELETE SET NULL,
          CONSTRAINT fk_fd_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_fd_society_number (society_id, fd_number),
          INDEX idx_fd_society_status (society_id, status),
          INDEX idx_fd_society_maturity (society_id, maturity_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS fd_transactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          fixed_deposit_id INT NOT NULL,
          transaction_type ENUM('EXISTING_REGISTER', 'NEW_FUNDING', 'INTEREST_PAYOUT', 'MATURITY', 'PREMATURE_CLOSURE') NOT NULL,
          transaction_date DATE NOT NULL,
          transaction_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          principal_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          interest_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          loss_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
          financial_account_id INT NULL DEFAULT NULL,
          reference_no VARCHAR(100) NULL DEFAULT NULL,
          remarks TEXT NULL DEFAULT NULL,
          created_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_fdt_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_fdt_fd FOREIGN KEY (fixed_deposit_id) REFERENCES fixed_deposits(id) ON DELETE CASCADE,
          CONSTRAINT fk_fdt_acc FOREIGN KEY (financial_account_id) REFERENCES society_financial_accounts(id) ON DELETE SET NULL,
          CONSTRAINT fk_fdt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          INDEX idx_fdt_society_fd (society_id, fixed_deposit_id),
          INDEX idx_fdt_society_date (society_id, transaction_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },

  async down(conn, isDryRun) {
    if (!isDryRun) {
      await conn.query("DROP TABLE IF EXISTS fd_transactions;");
      await conn.query("DROP TABLE IF EXISTS fixed_deposits;");
    }
  },
};
