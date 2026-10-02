/* ── Seed execution guard ───────────────────────────────────────────────────
   Every script under seed/ must call assertSeedAllowed() before touching the
   database.

   Why this exists:
     - seed/cleanup.js drops every table in DB_NAME with no checks.
     - seed/demoData.js can delete an existing society's rows (cleanupSociety)
       before re-seeding.
     - Nothing invoked these automatically, but there was nothing stopping an
       accidental run either, including one aimed at the development database.

   Rules:
     1. NODE_ENV=production always throws.
     2. Otherwise ALLOW_SEED=true must be set explicitly.
     3. Optional confirmation of the target database name.

   Neither override is ever set automatically. */

require("dotenv").config();

function assertSeedAllowed(scriptName, options = {}) {
    const { requireDatabaseConfirmation = false } = options;

    if (process.env.NODE_ENV === "production") {
        throw new Error(`Seed scripts are disabled in production (${scriptName}).`);
    }

    if (process.env.ALLOW_SEED !== "true") {
        console.error(
            `Seed execution blocked (${scriptName}).\n` +
            "Set ALLOW_SEED=true to run this seed script intentionally."
        );
        process.exit(1);
    }

    if (requireDatabaseConfirmation) {
        const dbName = process.env.DB_NAME;
        const expected = process.env.EXPECT_SEED_DB;
        if (expected && dbName !== expected) {
            console.error(
                `Seed execution blocked (${scriptName}): DB_NAME is "${dbName}" but EXPECT_SEED_DB is "${expected}".\n` +
                "Set EXPECT_SEED_DB to the database you intend to seed."
            );
            process.exit(1);
        }
        console.log(`[seed] ${scriptName} -> target database: ${dbName}`);
    }
}

module.exports = { assertSeedAllowed };
