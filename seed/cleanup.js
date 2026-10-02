const { assertSeedAllowed } = require("./seedGuard");

/* DESTRUCTIVE: drops every table in DB_NAME.
   Requires ALLOW_SEED=true, must not run in production, and — because there is
   no undo — also requires EXPECT_SEED_DB to name the database explicitly. */
assertSeedAllowed("cleanup.js", { requireDatabaseConfirmation: true });

require("dotenv").config();
const sequelize = require("../config/db");

(async () => {
await sequelize.authenticate();

const [rows] = await sequelize.query("SHOW TABLES");
const tableKey = Object.keys(rows[0])[0];
const tables = rows.map((r) => r[tableKey]);

if (tables.length === 0) {
console.log("Database is already empty.");
process.exit(0);
}

console.log(`⚠️  WARNING: dropping ${tables.length} table(s) from "${process.env.DB_NAME}". This cannot be undone.`);
console.log(`⚠️  Type the database name to confirm:`);

const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`Confirm database name [${process.env.DB_NAME}]: `, async (answer) => {
rl.close();
if (answer.trim() !== process.env.DB_NAME) {
console.log("Confirmation did not match. Aborting — nothing was dropped.");
process.exit(1);
}

await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
for (const t of tables) {
await sequelize.query(`DROP TABLE IF EXISTS \`${t}\``);
}
await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

console.log(`Dropped ${tables.length} tables from ${process.env.DB_NAME}. Database is clean.`);
process.exit(0);
});
})().catch((e) => { console.error(e.message); process.exit(1); });
