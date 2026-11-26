"use strict";

async function resolveTableName(conn, candidates) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
    [candidates]
  );
  return rows[0]?.TABLE_NAME || candidates[0];
}

async function getColumns(conn, table) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  return new Set(cols.map((c) => c.COLUMN_NAME));
}

module.exports = {
  name: "20261125000004-add-account-and-category-to-finance-tables.js",

  async up(conn, isDryRun) {
    console.log("  -> [Accounting] Altering existing finance tables for multi-account, FD, and category support...");
    if (isDryRun) return;

    // 1. societies: accounting_mode, accounting_cutover_date
    const socCols = await getColumns(conn, "societies");
    if (!socCols.has("accounting_mode")) {
      await conn.query("ALTER TABLE societies ADD COLUMN accounting_mode ENUM('LEGACY', 'MULTI_ACCOUNT') NOT NULL DEFAULT 'LEGACY'");
    }
    if (!socCols.has("accounting_cutover_date")) {
      await conn.query("ALTER TABLE societies ADD COLUMN accounting_cutover_date DATE NULL DEFAULT NULL");
    }

    // 2. expenses: financial_account_id, expense_category_id
    const expCols = await getColumns(conn, "expenses");
    if (!expCols.has("financial_account_id")) {
      await conn.query("ALTER TABLE expenses ADD COLUMN financial_account_id INT NULL DEFAULT NULL, ADD INDEX idx_expenses_fin_acc (financial_account_id)");
    }
    if (!expCols.has("expense_category_id")) {
      await conn.query("ALTER TABLE expenses ADD COLUMN expense_category_id INT NULL DEFAULT NULL, ADD INDEX idx_expenses_category (expense_category_id)");
    }

    // 3. ledger_entries: financial_account_id, fd_transaction_id, expand source ENUM
    const ledCols = await getColumns(conn, "ledger_entries");
    if (!ledCols.has("financial_account_id")) {
      await conn.query("ALTER TABLE ledger_entries ADD COLUMN financial_account_id INT NULL DEFAULT NULL, ADD INDEX idx_ledger_fin_acc (financial_account_id)");
    }
    if (!ledCols.has("fd_transaction_id")) {
      await conn.query("ALTER TABLE ledger_entries ADD COLUMN fd_transaction_id INT NULL DEFAULT NULL, ADD INDEX idx_ledger_fd_txn (fd_transaction_id)");
    }
    await conn.query(`
      ALTER TABLE ledger_entries MODIFY COLUMN source
      ENUM('BILL','MAINTENANCE','AMENITY','EXPENSE','ADJUSTMENT','CASH_IN','ACCOUNT_TRANSFER','FD_TRANSFER','FD_MATURITY','FD_INTEREST')
      NOT NULL
    `);

    // 4. Payments / payments: financial_account_id, razorpay_order_id, razorpay_payment_id, transaction_ref, confirmed_by, confirmed_at, status ENUM
    const payTable = await resolveTableName(conn, ["Payments", "payments"]);
    const payCols = await getColumns(conn, payTable);
    if (!payCols.has("financial_account_id")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN financial_account_id INT NULL DEFAULT NULL, ADD INDEX idx_payments_fin_acc (financial_account_id)`);
    }
    if (!payCols.has("razorpay_order_id")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN razorpay_order_id VARCHAR(64) NULL DEFAULT NULL`);
    }
    if (!payCols.has("razorpay_payment_id")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN razorpay_payment_id VARCHAR(64) NULL DEFAULT NULL, ADD UNIQUE INDEX uq_payments_rzp_id (razorpay_payment_id)`);
    }
    if (!payCols.has("transaction_ref")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN transaction_ref VARCHAR(120) NULL DEFAULT NULL`);
    }
    if (!payCols.has("confirmed_by")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN confirmed_by INT NULL DEFAULT NULL`);
    }
    if (!payCols.has("confirmed_at")) {
      await conn.query(`ALTER TABLE \`${payTable}\` ADD COLUMN confirmed_at DATETIME NULL DEFAULT NULL`);
    }
    await conn.query(`
      ALTER TABLE \`${payTable}\` MODIFY COLUMN status
      ENUM('INITIATED','PENDING','SUCCESS','FAILED','CANCELLED')
      DEFAULT 'PENDING'
    `);

    // 5. MaintenanceRates, bills, amenity_bookings: financial_account_id
    const mrCols = await getColumns(conn, "MaintenanceRates");
    if (!mrCols.has("financial_account_id")) {
      await conn.query("ALTER TABLE MaintenanceRates ADD COLUMN financial_account_id INT NULL DEFAULT NULL");
    }
    const billCols = await getColumns(conn, "bills");
    if (!billCols.has("financial_account_id")) {
      await conn.query("ALTER TABLE bills ADD COLUMN financial_account_id INT NULL DEFAULT NULL");
    }
    const abCols = await getColumns(conn, "amenity_bookings");
    if (!abCols.has("financial_account_id")) {
      await conn.query("ALTER TABLE amenity_bookings ADD COLUMN financial_account_id INT NULL DEFAULT NULL");
    }

    // 6. financial_audit_logs: expand action ENUM
    await conn.query(`
      ALTER TABLE financial_audit_logs MODIFY COLUMN action
      ENUM(
        'OPENING_BALANCE_SET','OPENING_BALANCE_ADJUST','EXPENSE_CREATE','EXPENSE_UPDATE','EXPENSE_VOID',
        'PAYMENT_REVERSED','MANUAL_ADJUSTMENT','MAINTENANCE_CONFIG_CREATED','MAINTENANCE_CONFIG_UPDATED',
        'MAINTENANCE_CONFIG_DELETED','MAINTENANCE_GENERATED',
        'FINANCIAL_ACCOUNT_CREATE','FINANCIAL_ACCOUNT_UPDATE','FINANCIAL_ACCOUNT_STATUS',
        'CASH_IN_ENTRY','CASH_ADJUSTMENT','ACCOUNT_TRANSFER',
        'EXPENSE_CATEGORY_CREATE','EXPENSE_CATEGORY_UPDATE','EXPENSE_CATEGORY_DELETE',
        'FD_EXISTING_REGISTER','FD_NEW_CREATE','FD_UPDATE','FD_INTEREST_PAYOUT','FD_MATURE','FD_PREMATURE_CLOSE'
      ) NOT NULL
    `);
  },

  async down(conn, isDryRun) {
    if (isDryRun) return;
    // Non-destructive rollback of new columns where safe
    for (const [tbl, col] of [
      ["amenity_bookings", "financial_account_id"],
      ["bills", "financial_account_id"],
      ["MaintenanceRates", "financial_account_id"],
      ["payments", "confirmed_at"],
      ["payments", "confirmed_by"],
      ["payments", "transaction_ref"],
      ["payments", "razorpay_payment_id"],
      ["payments", "razorpay_order_id"],
      ["payments", "financial_account_id"],
      ["ledger_entries", "fd_transaction_id"],
      ["ledger_entries", "financial_account_id"],
      ["expenses", "expense_category_id"],
      ["expenses", "financial_account_id"],
      ["societies", "accounting_cutover_date"],
      ["societies", "accounting_mode"],
    ]) {
      const cols = await getColumns(conn, tbl);
      if (cols.has(col)) {
        await conn.query(`ALTER TABLE ${tbl} DROP COLUMN ${col}`);
      }
    }
  },
};
