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

  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of tables) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

  console.log(`Dropped ${tables.length} tables. Database is clean.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
