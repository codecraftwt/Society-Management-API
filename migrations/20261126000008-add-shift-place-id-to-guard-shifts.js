"use strict";

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function constraintExists(conn, tableName, constraintName) {
  const [rows] = await conn.query(
    "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
    [tableName, constraintName]
  );
  return rows.length > 0;
}

module.exports = {
  name: "20261126000008-add-shift-place-id-to-guard-shifts.js",

  async up(conn, isDryRun) {
    console.log("  -> [Guard] Adding shift_place_id to guard_shifts...");
    if (isDryRun) return;

    const hasCol = await columnExists(conn, "guard_shifts", "shift_place_id");
    if (!hasCol) {
      await conn.query(`
        ALTER TABLE guard_shifts
        ADD COLUMN shift_place_id INT NULL DEFAULT NULL AFTER shift_type
      `);
    }

    const hasFk = await constraintExists(conn, "guard_shifts", "fk_guard_shifts_place");
    if (!hasFk) {
      await conn.query(`
        ALTER TABLE guard_shifts
        ADD CONSTRAINT fk_guard_shifts_place
        FOREIGN KEY (shift_place_id) REFERENCES guard_shift_places(id) ON DELETE SET NULL
      `);
    }
  },

  async down(conn, isDryRun) {
    console.log("  -> [Guard] Removing shift_place_id from guard_shifts...");
    if (isDryRun) return;

    const hasFk = await constraintExists(conn, "guard_shifts", "fk_guard_shifts_place");
    if (hasFk) {
      await conn.query("ALTER TABLE guard_shifts DROP FOREIGN KEY fk_guard_shifts_place");
    }

    const hasCol = await columnExists(conn, "guard_shifts", "shift_place_id");
    if (hasCol) {
      await conn.query("ALTER TABLE guard_shifts DROP COLUMN shift_place_id");
    }
  },
};
