require("dotenv").config();
const sequelize = require("../config/db");

const FINANCE_TABLES = [
  "fd_transactions",
  "fixed_deposits",
  "ledger_entries",
  "Payments",
  "expenses",
  "expense_categories",
  "bills",
  "amenity_bookings",
  "billing_rules",
  "MaintenanceRates",
  "financial_audit_logs",
];

async function tableExists(tableName) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)",
    { replacements: [tableName] }
  );
  return rows[0]?.TABLE_NAME || null;
}

async function run() {
  try {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DESTRUCTIVE_RESET !== "true") {
      throw new Error("Refusing destructive reset. Run with ALLOW_DESTRUCTIVE_RESET=true in non-production.");
    }

    await sequelize.authenticate();
    console.log("DB connected.");

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const candidate of FINANCE_TABLES) {
      const actualTable = await tableExists(candidate);
      if (!actualTable) {
        console.log(`Skipped ${candidate} (table not found).`);
        continue;
      }
      const [result] = await sequelize.query(`DELETE FROM \`${actualTable}\``);
      console.log(`Cleared ${actualTable} (${result.affectedRows} row(s) deleted).`);
    }

    const finAccTable = await tableExists("society_financial_accounts");
    if (finAccTable) {
      const [delBanks] = await sequelize.query(
        `DELETE FROM \`${finAccTable}\` WHERE account_type != 'CASH'`
      );
      console.log(`Deleted ${delBanks.affectedRows} non-CASH bank account(s).`);

      const [resetCash] = await sequelize.query(
        `UPDATE \`${finAccTable}\` SET opening_balance = 0.00, current_balance = 0.00, status = 'ACTIVE' WHERE account_type = 'CASH'`
      );
      console.log(`Reset ${resetCash.affectedRows} CASH account(s) to 0.00.`);
    }

    const [op] = await sequelize.query(
      `UPDATE societies SET
         opening_balance = 0,
         opening_balance_effective_date = NULL,
         opening_balance_set_by = NULL,
         opening_balance_set_at = NULL,
         accounting_mode = 'LEGACY',
         accounting_cutover_date = NULL`
    );
    console.log(`Reset accounting state on ${op.affectedRows} society/societies.`);

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("Finance reset complete.");
    process.exit(0);
  } catch (err) {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    console.error("Finance reset failed:", err);
    process.exit(1);
  }
}

run();
