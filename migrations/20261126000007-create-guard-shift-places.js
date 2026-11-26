"use strict";

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return rows.length > 0;
}

module.exports = {
  name: "20261126000007-create-guard-shift-places.js",

  async up(conn, isDryRun) {
    console.log("  -> [Guard] Creating guard_shift_places table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "guard_shift_places");
    if (!exists) {
      await conn.query(`
        CREATE TABLE guard_shift_places (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(255) NULL DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_guard_shift_places_society_name (society_id, name),
          CONSTRAINT fk_gsp_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Guard] Dropping guard_shift_places table...");
    if (isDryRun) return;

    const exists = await tableExists(conn, "guard_shift_places");
    if (exists) {
      await conn.query("DROP TABLE guard_shift_places");
    }
  },
};
