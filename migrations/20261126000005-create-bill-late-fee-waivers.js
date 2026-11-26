"use strict";

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return rows.length > 0;
}

module.exports = {
  name: "20261126000005-create-bill-late-fee-waivers.js",

  async up(conn, isDryRun) {
    console.log("  -> [Bills] Creating bill_late_fee_waivers table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "bill_late_fee_waivers");
    if (!exists) {
      await conn.query(`
        CREATE TABLE bill_late_fee_waivers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          bill_id INT NOT NULL,
          waiver_amount DECIMAL(10,2) NOT NULL,
          reason VARCHAR(500) NOT NULL,
          waived_by INT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_bill_late_fee_waivers_bill (bill_id),
          CONSTRAINT fk_blfw_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
          CONSTRAINT fk_blfw_user FOREIGN KEY (waived_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Bills] Dropping bill_late_fee_waivers table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "bill_late_fee_waivers");
    if (exists) {
      await conn.query("DROP TABLE bill_late_fee_waivers");
    }
  },
};
