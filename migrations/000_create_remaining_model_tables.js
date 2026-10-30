/**
 * Fresh-database model bootstrap.
 *
 * This migration deliberately derives SQL from the registered Sequelize
 * models rather than maintaining a second, drifting copy of every column.
 * It runs after 000_create_all_tables.js and before the incremental
 * multi-society/automation migrations. Existing tables are never dropped or
 * altered; CREATE TABLE and index creation are idempotent.
 */
module.exports = {
  name: "000_create_remaining_model_tables.js",

  async up(conn, isDryRun = false) {
    const models = require("../models");
    // These legacy model files are not exported from models/index.js. Load
    // them here as well so a fresh database covers every model file. OTP's
    // development fallback sync is disabled only while metadata is loaded.
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    for (const file of [
      "CleaningStaffAssignment",
      "ComplaintReadStatus",
      "FlatOwnership",
      "NoticeAcknowledgement",
      "OtpVerification",
    ]) {
      models[file] = require(`../models/${file}`);
    }
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    const queryGenerator = models.sequelize.getQueryInterface().queryGenerator;
    const entries = Object.values(models)
      .filter((model) => model && typeof model.getTableName === "function" && model.rawAttributes)
      .map((model) => ({ model, table: model.getTableName() }))
      .filter(({ table }) => typeof table === "string");

    const byTable = new Map(entries.map((entry) => [entry.table, entry]));
    const dependencies = (entry) => {
      const result = new Set();
      for (const attribute of Object.values(entry.model.rawAttributes)) {
        const reference = attribute.references;
        if (!reference) continue;
        const referencedModel = reference.model;
        const referencedTable = typeof referencedModel === "string"
          ? referencedModel
          : referencedModel && typeof referencedModel.getTableName === "function"
            ? referencedModel.getTableName()
            : null;
        if (referencedTable && referencedTable !== entry.table && byTable.has(referencedTable)) {
          result.add(referencedTable);
        }
      }
      return result;
    };

    const ordered = [];
    const visiting = new Set();
    const visited = new Set();
    const visit = (entry) => {
      if (visited.has(entry.table)) return;
      if (visiting.has(entry.table)) return; // tolerate association cycles
      visiting.add(entry.table);
      for (const dependency of dependencies(entry)) visit(byTable.get(dependency));
      visiting.delete(entry.table);
      visited.add(entry.table);
      ordered.push(entry);
    };
    entries.forEach(visit);

    for (const { model, table } of ordered) {
      const attributes = {};
      for (const [name, attribute] of Object.entries(model.rawAttributes)) {
        attributes[name] = queryGenerator.attributeToSQL(attribute);
      }
      const createSql = queryGenerator.createTableQuery(table, attributes);
      console.log(`  -> [000-models] ${isDryRun ? "Would create" : "Creating/checking"} ${table}`);
      if (!isDryRun) await conn.query(createSql);

      // 000_create_all_tables.js contains the legacy core definitions. Add
      // any model columns missing from those definitions without changing or
      // deleting existing production columns/data.
      const [columnRows] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [table]
      );
      const existingColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
      for (const [name, definition] of Object.entries(attributes)) {
        if (existingColumns.has(name)) continue;
        console.log(`     ${isDryRun ? "Would add" : "Adding"} ${table}.${name}`);
        if (!isDryRun) {
          await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
        }
      }

      const indexes = model.options?.indexes || [];
      for (const index of indexes) {
        if (!index.fields || index.fields.length === 0) continue;
        const [existing] = await conn.query(
          "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
          [table, index.name || `${table}_${index.fields.join("_")}`]
        );
        if (existing.length > 0) continue;
        if (!isDryRun) {
          await conn.query(queryGenerator.addIndexQuery(table, {
            ...index,
            name: index.name || `${table}_${index.fields.join("_")}`,
          }));
        }
      }
    }
  },

  async down() {
    // Production-safe migration chain: no destructive rollback is provided.
  },
};
