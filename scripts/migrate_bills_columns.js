const sequelize = require("../config/db");
const db = require("../models");

async function runMigration() {
  try {
    await sequelize.authenticate();
    console.log("DB connected successfully");

    // 1. Add bill_category to bills if missing
    const [cols] = await sequelize.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills'"
    );
    const colSet = new Set(cols.map((r) => r.COLUMN_NAME));

    if (!colSet.has("bill_category")) {
      await sequelize.query(
        "ALTER TABLE bills ADD COLUMN bill_category VARCHAR(50) NOT NULL DEFAULT 'OTHER' AFTER status"
      );
      console.log("Added bill_category to bills table");
    } else {
      console.log("bills.bill_category already exists");
    }

    if (!colSet.has("other_bill_type")) {
      await sequelize.query(
        "ALTER TABLE bills ADD COLUMN other_bill_type VARCHAR(255) NULL AFTER bill_category"
      );
      console.log("Added other_bill_type to bills table");
    } else {
      console.log("bills.other_bill_type already exists");
    }

    // 2. Sync RolePermission table
    if (db.RolePermission) {
      await db.RolePermission.sync();
      console.log("Synced RolePermission table");
    }

    console.log("Migration finished successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

runMigration();
