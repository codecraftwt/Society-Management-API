require("dotenv").config({ quiet: true });
const sequelize = require("../config/db");

const MIGRATIONS = [
  ["latitude", "ALTER TABLE `societies` ADD COLUMN `latitude` DECIMAL(10,7) NULL DEFAULT NULL"],
  ["longitude", "ALTER TABLE `societies` ADD COLUMN `longitude` DECIMAL(10,7) NULL DEFAULT NULL"],
  ["location_radius", "ALTER TABLE `societies` ADD COLUMN `location_radius` DECIMAL(8,2) NULL DEFAULT 50.00"],
];

(async () => {
  try {
    const [rows] = await sequelize.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'societies'"
    );
    const existing = new Set(rows.map((r) => r.COLUMN_NAME));

    for (const [column, sql] of MIGRATIONS) {
      if (existing.has(column)) {
        console.log(`societies.${column} already exists — skipping`);
      } else {
        await sequelize.query(sql);
        console.log(`Added societies.${column}`);
      }
    }
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();