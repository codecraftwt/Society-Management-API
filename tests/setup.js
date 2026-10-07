const fs = require("fs");
const path = require("path");

/* ── Test bootstrap ─────────────────────────────────────────────────────────
   This file runs before any test module is loaded (jest.config.js
   setupFilesAfterEnv), so the environment is established before
   `config/db.js` is imported by the app under test.

   Without this, `process.env.DB_NAME` still points at the development
   database from .env and the suite writes real notices, complaints, bills and
   user changes into it on every run.

   config/db.js additionally refuses to start when NODE_ENV=test and the
   resolved database equals the development database.                     */

process.env.NODE_ENV = "test";

/* Read the declared development database name straight from .env so it can be
   compared later, then point the process at an isolated test database. */
let declaredDevDatabaseName = null;
try {
    const envPath = path.resolve(__dirname, "..", ".env");
    if (fs.existsSync(envPath)) {
        declaredDevDatabaseName = require("dotenv").parse(fs.readFileSync(envPath)).DB_NAME || null;
    }
} catch (err) {
    declaredDevDatabaseName = null;
}

if (declaredDevDatabaseName) {
    process.env.DEV_DB_NAME = declaredDevDatabaseName;
}

const testDatabaseName = process.env.TEST_DB_NAME || `${declaredDevDatabaseName || "societyWeb"}_test`;
process.env.DB_NAME = testDatabaseName;

if (!global.io) {
    global.io = {
        to: () => ({ emit: () => {} }),
        emit: () => {},
    };
}

beforeAll(async () => {
    try {
        const sequelize = require("../config/db");
        const [rows] = await sequelize.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'"
        );
        const noticeCols = new Set(rows.map((r) => r.COLUMN_NAME));

        if (!noticeCols.has("target_type")) {
            await sequelize.query(
                "ALTER TABLE notices ADD COLUMN target_type ENUM('SOCIETY', 'FLAT') NOT NULL DEFAULT 'SOCIETY' AFTER acknowledgement_required"
            );
        }
        if (!noticeCols.has("target_flat_id")) {
            await sequelize.query(
                "ALTER TABLE notices ADD COLUMN target_flat_id INT NULL DEFAULT NULL AFTER target_type"
            );
        }

        const [socRows] = await sequelize.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'societies'"
        );
        const socCols = new Set(socRows.map((r) => r.COLUMN_NAME));
        if (!socCols.has("primary_color")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN primary_color VARCHAR(20) NULL DEFAULT NULL");
        }
        if (!socCols.has("accent_color")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN accent_color VARCHAR(20) NULL DEFAULT NULL");
        }
        if (!socCols.has("theme_updated_by")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN theme_updated_by INT NULL DEFAULT NULL");
        }
        if (!socCols.has("theme_updated_at")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN theme_updated_at DATETIME NULL DEFAULT NULL");
        }
        // Geofence columns are declared on the Society model; without them every
        // unpinned Society query throws "Unknown column 'latitude' in 'field list'".
        if (!socCols.has("latitude")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN latitude DECIMAL(10,7) NULL DEFAULT NULL");
        }
        if (!socCols.has("longitude")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN longitude DECIMAL(10,7) NULL DEFAULT NULL");
        }
        if (!socCols.has("location_radius")) {
            await sequelize.query("ALTER TABLE societies ADD COLUMN location_radius DECIMAL(8,2) NULL DEFAULT 50.00");
        }

        const [gaRows] = await sequelize.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guard_attendance'"
        );
        const gaCols = new Set(gaRows.map((r) => r.COLUMN_NAME));
        if (!gaCols.has("punch_in_accuracy")) {
            await sequelize.query("ALTER TABLE guard_attendance ADD COLUMN punch_in_accuracy DECIMAL(10,2) NULL DEFAULT NULL");
        }
        if (!gaCols.has("punch_in_distance")) {
            await sequelize.query("ALTER TABLE guard_attendance ADD COLUMN punch_in_distance DECIMAL(10,2) NULL DEFAULT NULL");
        }
        if (!gaCols.has("punch_in_radius")) {
            await sequelize.query("ALTER TABLE guard_attendance ADD COLUMN punch_in_radius DECIMAL(8,2) NULL DEFAULT NULL");
        }
        if (!gaCols.has("punch_out_accuracy")) {
            await sequelize.query("ALTER TABLE guard_attendance ADD COLUMN punch_out_accuracy DECIMAL(10,2) NULL DEFAULT NULL");
        }
        if (!gaCols.has("punch_out_distance")) {
            await sequelize.query("ALTER TABLE guard_attendance ADD COLUMN punch_out_distance DECIMAL(10,2) NULL DEFAULT NULL");
        }
    } catch (err) {
        // Table might not exist yet or query failed
    }
});

