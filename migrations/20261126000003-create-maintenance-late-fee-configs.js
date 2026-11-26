"use strict";

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return rows.length > 0;
}

module.exports = {
  name: "20261126000003-create-maintenance-late-fee-configs.js",

  async up(conn, isDryRun) {
    console.log("  -> [Maintenance] Creating maintenance_late_fee_configs table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "maintenance_late_fee_configs");
    if (!exists) {
      await conn.query(`
        CREATE TABLE maintenance_late_fee_configs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          is_enabled TINYINT(1) NOT NULL DEFAULT 0,
          fee_type ENUM('FIXED_PER_MONTH', 'FIXED_ONE_TIME', 'PERCENT_PER_MONTH') NOT NULL DEFAULT 'FIXED_PER_MONTH',
          fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          grace_days INT NOT NULL DEFAULT 0,
          max_fee_amount DECIMAL(10,2) NULL DEFAULT NULL,
          created_by INT NULL DEFAULT NULL,
          updated_by INT NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_maintenance_late_fee_society (society_id),
          CONSTRAINT fk_mlfc_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Maintenance] Dropping maintenance_late_fee_configs table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "maintenance_late_fee_configs");
    if (exists) {
      await conn.query("DROP TABLE maintenance_late_fee_configs");
    }
  },
};
