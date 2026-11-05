"use strict";

/**
 * Repair MaintenanceRates for installations created before the maintenance
 * configuration model was expanded.
 *
 * Older databases may still have flat_type as an ENUM. The API now supports
 * dynamic values such as ALL, ROW_HOUSE, and COMMERCIAL, so VARCHAR is the
 * compatible storage type. All changes are additive or widening changes and
 * preserve existing MaintenanceRates rows.
 */
module.exports = {
  async up(conn, isDryRun = false) {
    const [tables] = await conn.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MaintenanceRates'"
    );

    if (!tables.length) {
      throw new Error("MaintenanceRates table does not exist; run the base schema migrations first.");
    }

    if (isDryRun) return;

    const [columns] = await conn.query(
      "SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MaintenanceRates'"
    );
    const existing = new Set(columns.map((column) => column.COLUMN_NAME));

    // The API supports arbitrary configured flat labels, including ALL.
    // VARCHAR avoids MySQL ENUM truncation when a new label is introduced.
    const flatType = columns.find((column) => column.COLUMN_NAME === "flat_type");
    if (!flatType) {
      await conn.query("ALTER TABLE MaintenanceRates ADD COLUMN flat_type VARCHAR(50) NULL");
    } else if (!/^varchar\(/i.test(flatType.COLUMN_TYPE) || flatType.IS_NULLABLE !== "YES") {
      await conn.query("ALTER TABLE MaintenanceRates MODIFY COLUMN flat_type VARCHAR(50) NULL");
    }

    const additions = [
      ["maintenance_type", "VARCHAR(20) NULL"],
      ["name", "VARCHAR(255) NULL"],
      ["resident_type", "VARCHAR(20) NULL"],
      ["amount", "DECIMAL(10,2) NULL"],
      ["owner_amount", "DECIMAL(10,2) NULL"],
      ["tenant_amount", "DECIMAL(10,2) NULL"],
      ["rate_per_sqft", "DECIMAL(10,2) NULL"],
      ["owner_rate_per_sqft", "DECIMAL(10,4) NULL"],
      ["tenant_rate_per_sqft", "DECIMAL(10,4) NULL"],
      ["frequency", "VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'"],
      ["description", "TEXT NULL"],
      ["is_active", "TINYINT(1) NOT NULL DEFAULT 1"],
    ];

    for (const [name, definition] of additions) {
      if (!existing.has(name)) {
        await conn.query(`ALTER TABLE MaintenanceRates ADD COLUMN ${name} ${definition}`);
      }
    }

    // Legacy rows may predate maintenance_type. Keep them usable by the
    // current controller without changing any configured amounts.
    await conn.query(
      "UPDATE MaintenanceRates SET maintenance_type = 'FLAT' WHERE maintenance_type IS NULL"
    );

    // Backfill the new paired amounts from legacy amount fields only when the
    // paired values are currently empty.
    await conn.query(
      "UPDATE MaintenanceRates SET owner_amount = amount WHERE owner_amount IS NULL AND amount IS NOT NULL"
    );
    await conn.query(
      "UPDATE MaintenanceRates SET tenant_amount = owner_amount WHERE tenant_amount IS NULL AND owner_amount IS NOT NULL"
    );
    await conn.query(
      "UPDATE MaintenanceRates SET owner_rate_per_sqft = rate_per_sqft WHERE owner_rate_per_sqft IS NULL AND rate_per_sqft IS NOT NULL"
    );
    await conn.query(
      "UPDATE MaintenanceRates SET tenant_rate_per_sqft = owner_rate_per_sqft WHERE tenant_rate_per_sqft IS NULL AND owner_rate_per_sqft IS NOT NULL"
    );
  },

  async down() {
    // Deliberately non-destructive. Restoring an older ENUM can truncate valid
    // values such as ALL, ROW_HOUSE, or COMMERCIAL.
  },
};
