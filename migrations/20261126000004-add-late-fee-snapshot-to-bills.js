"use strict";

async function getColumns(conn, table) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  return new Set(cols.map((c) => c.COLUMN_NAME));
}

module.exports = {
  name: "20261126000004-add-late-fee-snapshot-to-bills.js",

  async up(conn, isDryRun) {
    console.log("  -> [Bills] Adding late fee policy snapshot columns to bills...");
    if (isDryRun) return;

    const cols = await getColumns(conn, "bills");
    if (!cols.has("late_fee_enabled")) {
      const afterClause = cols.has("calculation_details") ? " AFTER calculation_details" : "";
      await conn.query(`ALTER TABLE bills ADD COLUMN late_fee_enabled TINYINT(1) NOT NULL DEFAULT 0${afterClause}`);
    }
    if (!cols.has("late_fee_type")) {
      await conn.query("ALTER TABLE bills ADD COLUMN late_fee_type VARCHAR(32) NULL DEFAULT NULL AFTER late_fee_enabled");
    }
    if (!cols.has("late_fee_value")) {
      await conn.query("ALTER TABLE bills ADD COLUMN late_fee_value DECIMAL(10,2) NULL DEFAULT NULL AFTER late_fee_type");
    }
    if (!cols.has("late_fee_grace_days")) {
      await conn.query("ALTER TABLE bills ADD COLUMN late_fee_grace_days INT NOT NULL DEFAULT 0 AFTER late_fee_value");
    }
    if (!cols.has("late_fee_max_amount")) {
      await conn.query("ALTER TABLE bills ADD COLUMN late_fee_max_amount DECIMAL(10,2) NULL DEFAULT NULL AFTER late_fee_grace_days");
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Bills] Dropping late fee policy snapshot columns from bills...");
    if (isDryRun) return;

    const cols = await getColumns(conn, "bills");
    for (const col of [
      "late_fee_max_amount",
      "late_fee_grace_days",
      "late_fee_value",
      "late_fee_type",
      "late_fee_enabled",
    ]) {
      if (cols.has(col)) {
        await conn.query(`ALTER TABLE bills DROP COLUMN ${col}`);
      }
    }
  },
};
