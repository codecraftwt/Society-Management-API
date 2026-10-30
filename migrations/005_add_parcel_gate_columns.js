const tableExists = async (conn, tableName) => {
  const [rows] = await conn.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
};

const getColumns = async (conn, tableName) => {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
};

module.exports = {
  name: "005_add_parcel_gate_columns.js",

  async up(conn, isDryRun = false) {
    if (!(await tableExists(conn, "parcels"))) {
      console.log("     parcels table not found; skipping gate columns.");
      return;
    }

    const columns = await getColumns(conn, "parcels");
    const additions = [
      ["requested_by", "INT NULL DEFAULT NULL AFTER society_id"],
      ["arrival_guard_id", "INT NULL DEFAULT NULL AFTER guard_id"],
      ["delivery_guard_id", "INT NULL DEFAULT NULL AFTER arrival_guard_id"],
      ["pickup_time", "DATETIME NULL DEFAULT NULL AFTER entry_time"],
    ];

    for (const [name, definition] of additions) {
      if (columns.has(name)) continue;
      console.log(`     Adding parcels.${name}${isDryRun ? " (dry run)" : ""}...`);
      if (!isDryRun) {
        await conn.query(`ALTER TABLE \`parcels\` ADD COLUMN \`${name}\` ${definition}`);
      }
    }
  },

  async down() {
    throw new Error(
      "Destructive rollback is disabled for production safety. Restore a backup or use a reviewed recovery migration."
    );
  },
};
