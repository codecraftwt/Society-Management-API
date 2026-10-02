
const {Sequelize} = require("sequelize");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

/* Resolve the database name declared in .env (the development database).
   Parsed directly from the file so this value is authoritative even after a
   test bootstrap has reassigned process.env.DB_NAME. */
function readDeclaredDatabaseName() {
    try {
        const envPath = path.resolve(__dirname, "..", ".env");
        if (!fs.existsSync(envPath)) return process.env.DEV_DB_NAME || null;
        const parsed = require("dotenv").parse(fs.readFileSync(envPath));
        return parsed.DB_NAME || process.env.DEV_DB_NAME || null;
    } catch (err) {
        return process.env.DEV_DB_NAME || null;
    }
}

const resolvedDatabaseName = process.env.DB_NAME;

/* ── Safety guard ───────────────────────────────────────────────────────────
   Tests must NEVER run against the development database. Without this the
   Jest suite inserts records (notices/complaints/bills/users) into the real
   development data, once per run.

   ALLOW_TEST_ON_DEV_DB=true is an explicit emergency escape hatch only. It is
   never set automatically and is not required for normal `npm test`. */
if (process.env.NODE_ENV === "test") {
    const developmentDatabaseName = readDeclaredDatabaseName();

    if (!resolvedDatabaseName) {
        throw new Error(
            "Refusing to run tests: no database name resolved. " +
            "Set TEST_DB_NAME (or DB_NAME) to an isolated test database."
        );
    }

    if (
        resolvedDatabaseName === developmentDatabaseName &&
        process.env.ALLOW_TEST_ON_DEV_DB !== "true"
    ) {
        throw new Error(
            `Refusing to run tests against the development database "${resolvedDatabaseName}".\n` +
            `Configure an isolated test database, e.g. TEST_DB_NAME=${resolvedDatabaseName}_test ` +
            `(see tests/setup.js). Set ALLOW_TEST_ON_DEV_DB=true only as a deliberate emergency override.`
        );
    }

    // Advisory only: a test database whose name lacks "test" is usually a misconfiguration.
    if (!/test/i.test(resolvedDatabaseName)) {
        console.warn(
            `[db] Warning: tests are using "${resolvedDatabaseName}", which does not look like a test database.`
        );
    }
}

const sequelize = new Sequelize(
    resolvedDatabaseName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host : process.env.DB_HOST,
        port : process.env.DB_PORT || 3306,
        dialect : 'mysql',
        logging: false
    }
);

module.exports = sequelize;
