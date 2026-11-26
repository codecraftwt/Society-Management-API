"use strict";

module.exports = {
  name: "20261125000005-seed-cash-accounts-for-societies.js",

  async up(conn, isDryRun) {
    console.log("  -> [Accounting] Ensuring every existing society has a dedicated CASH account...");
    if (isDryRun) return;

    const [societies] = await conn.query("SELECT id FROM societies");
    for (const soc of societies) {
      const [existing] = await conn.query(
        "SELECT id FROM society_financial_accounts WHERE society_id = ? AND account_type = 'CASH' LIMIT 1",
        [soc.id]
      );
      if (existing.length === 0) {
        await conn.query(
          `INSERT INTO society_financial_accounts
           (society_id, account_name, account_type, opening_balance, current_balance, is_default, status)
           VALUES (?, 'Cash in Hand', 'CASH', 0.00, 0.00, 0, 'ACTIVE')`,
          [soc.id]
        );
      }
    }
  },

  async down(conn, isDryRun) {
    // Keep cash accounts safe; only remove unreferenced zero-balance seeded cash accounts if needed
    if (!isDryRun) {
      await conn.query(
        "DELETE FROM society_financial_accounts WHERE account_type = 'CASH' AND opening_balance = 0 AND current_balance = 0"
      );
    }
  },
};
