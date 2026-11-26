"use strict";

async function getColumns(conn, table) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  return new Set(cols.map((c) => c.COLUMN_NAME));
}

module.exports = {
  name: "20261126000002-add-guest-count-to-visitorlogs.js",

  async up(conn, isDryRun) {
    console.log("  -> [VisitorLog] Adding guest_count column to visitorlogs...");
    if (isDryRun) return;

    const cols = await getColumns(conn, "visitorlogs");
    if (!cols.has("guest_count")) {
      await conn.query(
        "ALTER TABLE visitorlogs ADD COLUMN guest_count INT NULL DEFAULT NULL AFTER vehicle_number"
      );
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [VisitorLog] Dropping guest_count column from visitorlogs...");
    if (isDryRun) return;

    const cols = await getColumns(conn, "visitorlogs");
    if (cols.has("guest_count")) {
      await conn.query("ALTER TABLE visitorlogs DROP COLUMN guest_count");
    }
  },
};
