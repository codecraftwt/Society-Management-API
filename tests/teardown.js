const fs = require("fs");
const path = require("path");

/* ── Global test teardown ───────────────────────────────────────────────────
   Removes records the API suite created, so the isolated test database does
   not accumulate fixtures across runs (the same failure mode that polluted the
   development database).

   SAFETY: this runs only against a database that is demonstrably NOT the
   development database. If the test database cannot be identified, it refuses
   to delete anything. */

process.env.NODE_ENV = "test";

let declaredDevDatabaseName = null;
try {
    const envPath = path.resolve(__dirname, "..", ".env");
    if (fs.existsSync(envPath)) {
        declaredDevDatabaseName = require("dotenv").parse(fs.readFileSync(envPath)).DB_NAME || null;
    }
} catch (err) {
    declaredDevDatabaseName = null;
}

const targetDatabaseName = process.env.TEST_DB_NAME || `${declaredDevDatabaseName || "societyWeb"}_test`;

module.exports = async function globalTeardown() {
    if (process.env.ALLOW_TEST_ON_DEV_DB === "true") {
        console.warn("[teardown] ALLOW_TEST_ON_DEV_DB=true — skipping cleanup entirely.");
        return;
    }

    if (!targetDatabaseName) {
        console.warn("[teardown] Could not resolve a test database name — skipping cleanup.");
        return;
    }

    if (declaredDevDatabaseName && targetDatabaseName === declaredDevDatabaseName) {
        console.warn(
            `[teardown] Refusing to clean "${targetDatabaseName}" because it is the development database. Skipping.`
        );
        return;
    }

    if (!/test/i.test(targetDatabaseName)) {
        console.warn(
            `[teardown] Refusing to clean "${targetDatabaseName}" — name does not identify a test database. Skipping.`
        );
        return;
    }

    let sequelize;
    try {
        const API_ROOT = path.resolve(__dirname, "..");
        require(path.join(API_ROOT, "node_modules", "dotenv")).config({ path: path.join(API_ROOT, ".env") });
        process.env.DB_NAME = targetDatabaseName;
        const { Sequelize } = require(path.join(API_ROOT, "node_modules", "sequelize"));
        sequelize = new Sequelize(
            targetDatabaseName,
            process.env.DB_USER,
            process.env.DB_PASSWORD,
            {
                host: process.env.DB_HOST,
                port: process.env.DB_PORT || 3306,
                dialect: "mysql",
                logging: false,
            }
        );
        await sequelize.authenticate();
    } catch (err) {
        console.warn(`[teardown] Could not connect to "${targetDatabaseName}" — skipping cleanup. ${err.message}`);
        if (sequelize) await sequelize.close().catch(() => {});
        return;
    }

    /* Child rows first. Tags come from tests/helpers/api.js `unique()` prefixes
       and the literal fixtures used by notices-complaints.test.js. */
    const statements = [
        ["complaint_comments", "DELETE FROM complaint_comments WHERE comment = 'test comment'"],
        ["complaint_read_status", "DELETE FROM complaint_read_status WHERE complaint_id IN (SELECT id FROM complaints WHERE title LIKE 'Complaint-%' OR title = 'x')"],
        ["notifications (test notices/complaints)", "DELETE FROM notifications WHERE message LIKE '%\"x\"%' OR message LIKE '%API Notice-%' OR message LIKE '%Complaint-%'"],
        ["amenity_bookings (test)", "DELETE FROM amenity_bookings WHERE amenity_id IN (SELECT id FROM amenities WHERE name LIKE 'Amenity-%')"],
        ["amenities (test)", "DELETE FROM amenities WHERE name LIKE 'Amenity-%'"],
        ["billing_rules (test)", "DELETE FROM billing_rules WHERE name LIKE 'Rule-%'"],
        ["guard_logs (test)", "DELETE FROM guard_logs WHERE text LIKE 'API log-%'"],
        ["vehicles (test)", "DELETE FROM vehicles WHERE vehicle_number LIKE 'TEST-%'"],
        ["visitor_preapprovals (test)", "DELETE FROM visitor_preapprovals WHERE purpose LIKE 'Guest-%'"],
        ["notices (test)", "DELETE FROM notices WHERE title LIKE 'API Notice-%' OR title = 'x'"],
        ["complaints (test)", "DELETE FROM complaints WHERE title LIKE 'Complaint-%' OR title = 'x'"],
        ["societies (test)", "DELETE FROM societies WHERE name LIKE 'API Test Society-%'"],
    ];

    let removed = 0;
    try {
        await sequelize.query("SET FOREIGN_KEY_CHECKS=0");
        for (const [label, sql] of statements) {
            try {
                const [result] = await sequelize.query(sql);
                const affected = result && typeof result.affectedRows === "number" ? result.affectedRows : 0;
                if (affected > 0) {
                    removed += affected;
                    console.log(`[teardown] ${label}: removed ${affected}`);
                }
            } catch (err) {
                /* A table or column may not exist in a given schema. Never abort the sweep. */
                console.log(`[teardown] skipped "${label}": ${err.message.split("\n")[0]}`);
            }
        }
        await sequelize.query("SET FOREIGN_KEY_CHECKS=1");
        console.log(`[teardown] "${targetDatabaseName}" cleaned — ${removed} test row(s) removed.`);
    } catch (err) {
        console.warn(`[teardown] Cleanup error: ${err.message}`);
    } finally {
        await sequelize.close().catch(() => {});
    }
};
