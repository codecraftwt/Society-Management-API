const sequelize = require("../config/db");

const FINANCE_TABLES = [
  "amenity_bookings",
  "Payments",
  "ledger_entries",
  "bills",
  "expenses",
  "billing_rules",
  "MaintenanceRates",
  "accountant_assignments",
  "financial_audit_logs",
];

async function run() {
  try {
    await sequelize.authenticate();
    console.log("DB connected.");

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of FINANCE_TABLES) {
      const [result] = await sequelize.query(`DELETE FROM \`${table}\``);
      console.log(`Cleared ${table} (${result.affectedRows} row(s) deleted).`);
    }

    const [op] = await sequelize.query(
      `UPDATE societies SET opening_balance = 0,
         opening_balance_effective_date = NULL,
         opening_balance_set_by = NULL,
         opening_balance_set_at = NULL`
    );
    console.log(`Reset opening balance on ${op.affectedRows} society/societies.`);

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("Reset complete.");
    process.exit(0);
  } catch (err) {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    console.error("Reset failed:", err);
    process.exit(1);
  }
}

run();