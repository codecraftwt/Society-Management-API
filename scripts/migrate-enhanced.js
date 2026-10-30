// Enhanced migration runner with better validation and reporting
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const MIGRATION_LOCK_NAME = "society_migrations_runner";

// Required env vars for migration
const REQUIRED_ENV_VARS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

function validateEnvironment() {
  const missing = [];
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  if (missing.length > 0) {
    console.error(`[Migrate] Missing required environment variables: ${missing.join(", ")}`);
    console.error('[Migrate] Please check your .env file');
    process.exit(1);
  }
}

async function acquireMigrationLock(conn) {
  const [[row]] = await conn.query("SELECT GET_LOCK(?, 0) AS acquired", [MIGRATION_LOCK_NAME]);
  if (Number(row?.acquired) !== 1) {
    throw new Error("Another migration process is already running. Try again after it finishes.");
  }
}

async function releaseMigrationLock(conn) {
  try {
    await conn.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
  } catch (_) {}
}

async function getConnection() {
  validateEnvironment();
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
}

async function ensureMigrationTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT NOT NULL DEFAULT 0,
      status VARCHAR(20) DEFAULT 'success',
      error_message TEXT NULL
      ,checksum CHAR(64) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  );

  // Older installations may have the original three-column table. CREATE TABLE
  // IF NOT EXISTS does not add columns, so upgrade it explicitly and safely.
  const [columns] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const additions = [
    ["execution_ms", "INT NOT NULL DEFAULT 0"],
    ["status", "VARCHAR(20) NOT NULL DEFAULT 'success'"],
    ["error_message", "TEXT NULL"],
    ["checksum", "CHAR(64) NULL"],
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await conn.query(`ALTER TABLE schema_migrations ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function migrationTableExists(conn) {
  const [rows] = await conn.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' LIMIT 1"
  );
  return rows.length > 0;
}

async function getAppliedMigrations(conn) {
  const [rows] = await conn.query("SELECT name, applied_at, execution_ms, status, checksum FROM schema_migrations ORDER BY id ASC");
  return new Map(rows.map((r) => [r.name, r]));
}

async function run() {
  const isDryRun = process.argv.includes("--dry-run");
  const isStatusOnly = process.argv.includes("--status");

  if (!isDryRun && !isStatusOnly && process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "true") {
    throw new Error("Production migrations require ALLOW_PRODUCTION_MIGRATIONS=true and an approved deployment step.");
  }

  console.log(`[Migrate] Starting migration runner`);
  console.log(`[Migrate] DB: ${process.env.DB_NAME || "(configured database)"} @ ${process.env.DB_HOST || "(configured host)"}:${process.env.DB_PORT || "3306"}`);
  if (isDryRun) console.log("[Migrate] === DRY RUN MODE (No changes will be written) ===");

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js") && !f.includes('templates'))
    .sort();

  if (migrationFiles.length === 0) {
    console.log("[Migrate] No migration files found in migrations/ directory.");
    return;
  }

  const conn = await getConnection();

  try {
    await acquireMigrationLock(conn);
    const trackingExists = await migrationTableExists(conn);
    if (!isDryRun && !isStatusOnly) await ensureMigrationTable(conn);
    const appliedMap = trackingExists ? await getAppliedMigrations(conn) : new Map();

    if (isStatusOnly) {
      console.log("\n--- Migration Status ---");
      for (const file of migrationFiles) {
        const applied = appliedMap.get(file);
        if (applied) {
          const status = applied.status || 'success';
          console.log(`[${status.toUpperCase()}] ${file} (${applied.execution_ms} ms)`);
        } else {
          console.log(`[PENDING] ${file}`);
        }
      }
      return;
    }

    const pending = migrationFiles.filter((f) => !appliedMap.has(f) || appliedMap.get(f).status === 'failed');
    for (const file of migrationFiles) {
      const applied = appliedMap.get(file);
      if (applied?.checksum) {
        const checksum = crypto.createHash("sha256").update(fs.readFileSync(path.join(MIGRATIONS_DIR, file))).digest("hex");
        if (checksum !== applied.checksum) throw new Error(`Applied migration ${file} has been modified; restore the original file or create a new migration.`);
      }
    }
    console.log(`[Migrate] Found ${migrationFiles.length} total migration(s), ${pending.length} pending/failed.`);

    if (pending.length === 0) {
      console.log("[Migrate] All migrations are already up to date.");
      return;
    }

    for (const file of pending) {
      console.log(`\n[Migrate] Applying migration: ${file}`);
      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const migration = require(migrationPath);
      const checksum = crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");

      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} does not export an 'up(conn, isDryRun)' function.`);
      }

      const start = Date.now();
      try {
        await migration.up(conn, isDryRun);
        const duration = Date.now() - start;

        if (!isDryRun) {
          // Remove old failed record if exists
          await conn.query(
            "INSERT INTO schema_migrations (name, execution_ms, status, checksum) VALUES (?, ?, 'success', ?) ON DUPLICATE KEY UPDATE execution_ms = VALUES(execution_ms), status = 'success', error_message = NULL, checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP",
            [file, duration, checksum]
          );
          console.log(`[Migrate] Successfully applied ${file} in ${duration} ms.`);
        } else {
          console.log(`[Migrate] [DRY RUN] ${file} would succeed (simulated in ${duration} ms).`);
        }
      } catch (err) {
        const duration = Date.now() - start;
        if (!isDryRun) {
          await conn.query(
            "INSERT INTO schema_migrations (name, execution_ms, status, error_message, checksum) VALUES (?, ?, 'failed', ?, ?) ON DUPLICATE KEY UPDATE execution_ms = VALUES(execution_ms), status = 'failed', error_message = VALUES(error_message), checksum = VALUES(checksum)",
            [file, duration, err.message.substring(0, 500), checksum]
          );
        }
        console.error(`\n[Migrate] ERROR applying ${file}:`, err.message);
        throw err;
      }
    }

    console.log("\n[Migrate] Migration process finished successfully.");
  } finally {
    await releaseMigrationLock(conn);
    await conn.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("\n[Migrate] ERROR:", err.message);
    if (err.stack && process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { run, getConnection };
