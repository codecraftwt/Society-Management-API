const GUARD_ATTENDANCE_COLUMNS = [
  ["scheduled_end_at", "DATETIME NULL DEFAULT NULL AFTER punch_in"],
  ["auto_punch_out_due_at", "DATETIME NULL DEFAULT NULL AFTER scheduled_end_at"],
  ["shift_end_notified_at", "DATETIME NULL DEFAULT NULL AFTER auto_punch_out_due_at"],
  ["acknowledged_at", "DATETIME NULL DEFAULT NULL AFTER shift_end_notified_at"],
  ["is_auto_punch_out", "TINYINT(1) NOT NULL DEFAULT 0 AFTER acknowledged_at"],
  ["auto_punch_out_at", "DATETIME NULL DEFAULT NULL AFTER is_auto_punch_out"],
  ["auto_punch_out_reason", "VARCHAR(50) NULL DEFAULT NULL AFTER auto_punch_out_at"],
  ["punch_out_source", "VARCHAR(20) NULL DEFAULT NULL AFTER auto_punch_out_reason"],
];

const NOTIFICATION_COLUMNS = [
  ["source_event_id", "VARCHAR(191) NULL DEFAULT NULL AFTER receiver_user_id"],
  ["push_status", "VARCHAR(20) NULL DEFAULT NULL AFTER source_event_id"],
  ["push_attempted_at", "DATETIME NULL DEFAULT NULL AFTER push_status"],
  ["push_error", "VARCHAR(255) NULL DEFAULT NULL AFTER push_attempted_at"],
];

const GUARD_ATTENDANCE_INDEXES = [
  ["idx_ga_status_due", "ADD INDEX idx_ga_status_due (status, auto_punch_out_due_at)"],
  ["idx_ga_status_date", "ADD INDEX idx_ga_status_date (status, attendance_date)"],
  ["idx_ga_shift_end_notice", "ADD INDEX idx_ga_shift_end_notice (shift_end_notified_at, scheduled_end_at)"],
];

const NOTIFICATION_INDEXES = [
  [
    "uniq_notification_source_event",
    "ADD UNIQUE KEY uniq_notification_source_event (source_event_id, receiver_user_id, type)",
  ],
];

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

const getIndexes = async (conn, tableName) => {
  const [rows] = await conn.query(
    "SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return new Set(rows.map((row) => row.INDEX_NAME));
};

const addColumns = async (conn, tableName, columns, isDryRun) => {
  const existing = await getColumns(conn, tableName);
  for (const [name, definition] of columns) {
    if (existing.has(name)) continue;
    console.log(`     Adding ${tableName}.${name}...`);
    if (!isDryRun) {
      await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }
};

const addIndexes = async (conn, tableName, indexes, isDryRun) => {
  const existing = await getIndexes(conn, tableName);
  for (const [name, definition] of indexes) {
    if (existing.has(name)) continue;
    console.log(`     Adding index ${name} on ${tableName}...`);
    if (!isDryRun) {
      await conn.query(`ALTER TABLE \`${tableName}\` ${definition}`);
    }
  }
};

module.exports = {
  name: "003_guard_attendance_automation.js",

  async up(conn, isDryRun) {
    if (await tableExists(conn, "guard_attendance")) {
      await addColumns(conn, "guard_attendance", GUARD_ATTENDANCE_COLUMNS, isDryRun);
      await addIndexes(conn, "guard_attendance", GUARD_ATTENDANCE_INDEXES, isDryRun);
    } else {
      console.log("     guard_attendance table not found; skipping its automation columns.");
    }

    if (await tableExists(conn, "notifications")) {
      await addColumns(conn, "notifications", NOTIFICATION_COLUMNS, isDryRun);
      await addIndexes(conn, "notifications", NOTIFICATION_INDEXES, isDryRun);
    } else {
      console.log("     notifications table not found; skipping its deduplication columns.");
    }
  },

  async down(conn) {
    if (await tableExists(conn, "notifications")) {
      const indexes = await getIndexes(conn, "notifications");
      if (indexes.has("uniq_notification_source_event")) {
        await conn.query("ALTER TABLE `notifications` DROP INDEX `uniq_notification_source_event`");
      }
      const columns = await getColumns(conn, "notifications");
      for (const name of ["push_error", "push_attempted_at", "push_status", "source_event_id"]) {
        if (columns.has(name)) {
          await conn.query(`ALTER TABLE \`notifications\` DROP COLUMN \`${name}\``);
        }
      }
    }

    if (await tableExists(conn, "guard_attendance")) {
      const indexes = await getIndexes(conn, "guard_attendance");
      for (const name of ["idx_ga_shift_end_notice", "idx_ga_status_date", "idx_ga_status_due"]) {
        if (indexes.has(name)) {
          await conn.query(`ALTER TABLE \`guard_attendance\` DROP INDEX \`${name}\``);
        }
      }
      const columns = await getColumns(conn, "guard_attendance");
      for (const name of [
        "punch_out_source",
        "auto_punch_out_reason",
        "auto_punch_out_at",
        "is_auto_punch_out",
        "acknowledged_at",
        "shift_end_notified_at",
        "auto_punch_out_due_at",
        "scheduled_end_at",
      ]) {
        if (columns.has(name)) {
          await conn.query(`ALTER TABLE \`guard_attendance\` DROP COLUMN \`${name}\``);
        }
      }
    }
  },
};
