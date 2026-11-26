"use strict";

module.exports = {
  name: "20261125000002-create-expense-categories.js",

  async up(conn, isDryRun) {
    console.log("  -> [Accounting] Creating expense_categories table...");
    if (!isDryRun) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS expense_categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(255) NULL DEFAULT NULL,
          status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
          created_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_exp_cat_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
          CONSTRAINT fk_exp_cat_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE KEY uq_expense_cat_society_name (society_id, name),
          INDEX idx_exp_cat_society_status (society_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },

  async down(conn, isDryRun) {
    if (!isDryRun) {
      await conn.query("DROP TABLE IF EXISTS expense_categories;");
    }
  },
};
