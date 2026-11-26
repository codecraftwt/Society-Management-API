"use strict";

async function resolveTableName(conn, candidates) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
    [candidates]
  );
  return rows[0]?.TABLE_NAME || candidates[0];
}

async function getColumns(conn, table) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  return new Set(cols.map((c) => c.COLUMN_NAME));
}

module.exports = {
  name: "20261126000006-add-late-fee-breakdown-to-payments.js",

  async up(conn, isDryRun) {
    console.log("  -> [Payments] Adding late fee breakdown columns to payments...");
    if (isDryRun) return;

    const table = await resolveTableName(conn, ["payments", "Payments"]);
    const cols = await getColumns(conn, table);
    if (!cols.has("base_amount")) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN base_amount DECIMAL(10,2) NULL DEFAULT NULL AFTER amount`);
    }
    if (!cols.has("late_fee_amount")) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN late_fee_amount DECIMAL(10,2) NULL DEFAULT 0.00 AFTER base_amount`);
    }
    if (!cols.has("waived_amount")) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN waived_amount DECIMAL(10,2) NULL DEFAULT 0.00 AFTER late_fee_amount`);
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Payments] Dropping late fee breakdown columns from payments...");
    if (isDryRun) return;

    const table = await resolveTableName(conn, ["payments", "Payments"]);
    const cols = await getColumns(conn, table);
    for (const col of ["waived_amount", "late_fee_amount", "base_amount"]) {
      if (cols.has(col)) {
        await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN ${col}`);
      }
    }
  },
};
