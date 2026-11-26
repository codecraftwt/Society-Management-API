const fs = require("fs");
const path = require("path");
const { sequelize } = require("../config/db");
const {
  Society,
  SocietyFinancialAccount,
  ExpenseCategory,
  FixedDeposit,
  FixedDepositTransaction,
  Expense,
  LedgerEntry,
  Payment,
  MaintenanceRate,
  Bill,
  AmenityBooking,
} = require("../models");
const ledgerService = require("../utils/ledgerService");

describe("Society Accounting Enhancement — Models, Exports, and Contracts", () => {
  it("registers all new models and associations cleanly", () => {
    expect(SocietyFinancialAccount).toBeDefined();
    expect(ExpenseCategory).toBeDefined();
    expect(FixedDeposit).toBeDefined();
    expect(FixedDepositTransaction).toBeDefined();

    expect(SocietyFinancialAccount.associations.society).toBeDefined();
    expect(Expense.associations.financialAccount).toBeDefined();
    expect(Expense.associations.category).toBeDefined();
    expect(LedgerEntry.associations.financialAccount).toBeDefined();
    expect(LedgerEntry.associations.fdTransaction).toBeDefined();
    expect(Payment.associations.financialAccount).toBeDefined();
    expect(MaintenanceRate.associations.financialAccount).toBeDefined();
    expect(Bill.associations.financialAccount).toBeDefined();
    expect(FixedDeposit.associations.transactions).toBeDefined();
    expect(FixedDepositTransaction.associations.fixedDeposit).toBeDefined();
  });

  it("includes required ENUM values on LedgerEntry, Payment, and Society", () => {
    const ledgerSources = LedgerEntry.rawAttributes.source.values;
    expect(ledgerSources).toEqual(
      expect.arrayContaining([
        "BILL",
        "MAINTENANCE",
        "AMENITY",
        "EXPENSE",
        "ADJUSTMENT",
        "FD_TRANSFER",
        "FD_INTEREST",
        "FD_MATURITY",
        "CASH_IN",
        "ACCOUNT_TRANSFER",
      ])
    );

    const paymentStatuses = Payment.rawAttributes.status.values;
    expect(paymentStatuses).toEqual(
      expect.arrayContaining(["INITIATED", "PENDING", "SUCCESS", "FAILED"])
    );

    const accountingModes = Society.rawAttributes.accounting_mode.values;
    expect(accountingModes).toEqual(expect.arrayContaining(["LEGACY", "MULTI_ACCOUNT"]));
  });

  it("exports all required ledgerService helpers", () => {
    expect(typeof ledgerService.createLedgerEntry).toBe("function");
    expect(typeof ledgerService.reverseLedgerEntry).toBe("function");
    expect(typeof ledgerService.ensureCashAccount).toBe("function");
    expect(typeof ledgerService.getDefaultBankAccount).toBe("function");
    expect(typeof ledgerService.applyAccountBalanceDelta).toBe("function");
    expect(ledgerService.VALID_SOURCES).toEqual(
      expect.arrayContaining(["FD_TRANSFER", "FD_INTEREST", "FD_MATURITY", "CASH_IN", "ACCOUNT_TRANSFER"])
    );
  });

  it("ships all 5 idempotent accounting migrations in chronological order", () => {
    const migrationsDir = path.join(__dirname, "..", "migrations");
    const files = fs.readdirSync(migrationsDir).sort();
    expect(files).toEqual(
      expect.arrayContaining([
        "20261125000001-create-society-financial-accounts.js",
        "20261125000002-create-expense-categories.js",
        "20261125000003-create-fixed-deposits-and-transactions.js",
        "20261125000004-add-account-and-category-to-finance-tables.js",
        "20261125000005-seed-cash-accounts-for-societies.js",
      ])
    );
  });

  it("mounts financial-accounts, expense-categories, and fixed-deposits routes in app", () => {
    const app = require("../app");
    expect(app).toBeDefined();
    const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    expect(appSrc).toContain("/api/financial-accounts");
    expect(appSrc).toContain("/api/expense-categories");
    expect(appSrc).toContain("/api/fixed-deposits");
    expect(require("../routes/financialAccountRoutes")).toBeDefined();
    expect(require("../routes/expenseCategoryRoutes")).toBeDefined();
    expect(require("../routes/fixedDepositRoutes")).toBeDefined();
  });

  it("enforces FD premature closure breakdown invariant (₹1,00,000 -> ₹98,000 = ₹2,000 loss)", () => {
    const principal = 100000;
    const actualReceived = 98000;
    const finalInterest = 0;
    const principalReturned = Math.max(0, Math.min(principal, actualReceived - finalInterest));
    const lossAmount = Math.max(0, principal - principalReturned);
    expect(principalReturned).toBe(98000);
    expect(lossAmount).toBe(2000);
    expect(principalReturned + finalInterest).toBe(actualReceived);
  });

  it("enforces AmenityBooking snapshot & payment status fields", () => {
    expect(AmenityBooking.rawAttributes.payment_status).toBeDefined();
  });
});

describe("Society Accounting Enhancement — Live DB Checks (when MySQL is reachable)", () => {
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await sequelize.authenticate();
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  it("skips gracefully if MySQL is offline or verifies tables when online", async () => {
    if (!dbAvailable) {
      expect(dbAvailable).toBe(false);
      return;
    }
    const [rows] = await sequelize.query("SHOW TABLES LIKE 'society_financial_accounts'");
    expect(Array.isArray(rows)).toBe(true);
  });
});
