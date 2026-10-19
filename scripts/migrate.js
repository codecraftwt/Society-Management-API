/**
 * Zero-Dependency Migration Runner for Society Management API
 * Usage:
 *   node scripts/migrate.js           # Run pending migrations
 *   node scripts/migrate.js --dry-run # Check pending migrations without applying
 *   node scripts/migrate.js --status  # View status of all migrations
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

async function getConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3307", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "societyWeb",
    multipleStatements: true,
  });
}

async function ensureMigrationTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function getAppliedMigrations(conn) {
  const [rows] = await conn.query("SELECT name, applied_at, execution_ms FROM schema_migrations ORDER BY id ASC");
  return new Map(rows.map((r) => [r.name, r]));
}

async function run() {
  const isDryRun = process.argv.includes("--dry-run");
  const isStatusOnly = process.argv.includes("--status");

  console.log(`[Migrate] Starting migration runner (DB: ${process.env.DB_NAME || "societyWeb"}, Port: ${process.env.DB_PORT || 3307})`);
  if (isDryRun) console.log("[Migrate] === DRY RUN MODE (No changes will be written) ===");

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();

  if (migrationFiles.length === 0) {
    console.log("[Migrate] No migration files found in migrations/ directory.");
    return;
  }

  const conn = await getConnection();

  try {
    await ensureMigrationTable(conn);
    const appliedMap = await getAppliedMigrations(conn);

    if (isStatusOnly) {
      console.log("\n--- Migration Status ---");
      for (const file of migrationFiles) {
        const applied = appliedMap.get(file);
        if (applied) {
          console.log(` [APPLIED] ${file} (${new Date(applied.applied_at).toLocaleString()} - ${applied.execution_ms}ms)`);
        } else {
          console.log(` [PENDING] ${file}`);
        }
      }
      return;
    }

    const pending = migrationFiles.filter((f) => !appliedMap.has(f));
    console.log(`[Migrate] Found ${migrationFiles.length} total migration(s), ${pending.length} pending.`);

    if (pending.length === 0) {
      console.log("[Migrate] All migrations are already up to date.");
      return;
    }

    for (const file of pending) {
      console.log(`\n[Migrate] ${isDryRun ? "Simulating" : "Applying"} migration: ${file}`);
      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const migration = require(migrationPath);

      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} does not export an 'up(conn, isDryRun)' function.`);
      }

      const start = Date.now();
      await migration.up(conn, isDryRun);
      const duration = Date.now() - start;

      if (!isDryRun) {
        await conn.query(
          "INSERT INTO schema_migrations (name, execution_ms) VALUES (?, ?)",
          [file, duration]
        );
        console.log(`[Migrate] Successfully applied ${file} in ${duration}ms.`);
      } else {
        console.log(`[Migrate] [DRY RUN] ${file} would succeed (simulated in ${duration}ms).`);
      }
    }

    console.log("\n[Migrate] Migration process finished successfully.");
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("\n[Migrate] ERROR:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { run, getConnection };
