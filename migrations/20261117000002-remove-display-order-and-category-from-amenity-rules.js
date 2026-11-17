"use strict";

/**
 * Migration 20261117000002: Remove display_order and category from amenity_rules,
 * add rule_type ('TEXT', 'IMAGE', 'PDF'), and allow content to be nullable.
 */

module.exports = {
  name: "20261117000002-remove-display-order-and-category-from-amenity-rules.js",

  async up(conn, isDryRun) {
    console.log("  -> [Amenity Rules Update] Inspecting amenity_rules columns and indexes...");
    if (isDryRun) return;

    // 1. Get existing columns
    const [columns] = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_rules'"
    );
    const existingCols = new Set(columns.map((c) => c.COLUMN_NAME));

    // 2. Drop existing index that depends on display_order
    try {
      const [indexes] = await conn.query(
        "SHOW INDEX FROM amenity_rules WHERE Key_name = 'idx_amenity_rules_society_active'"
      );
      if (indexes && indexes.length > 0) {
        await conn.query("ALTER TABLE amenity_rules DROP INDEX idx_amenity_rules_society_active");
        console.log("     + Dropped legacy index idx_amenity_rules_society_active");
      }
    } catch (e) {
      console.warn("     ! Notice on dropping index:", e.message);
    }

    // 3. Remove display_order if present
    if (existingCols.has("display_order")) {
      await conn.query("ALTER TABLE amenity_rules DROP COLUMN display_order");
      console.log("     + Successfully dropped display_order column from amenity_rules");
    }

    // 4. Remove category if present
    if (existingCols.has("category")) {
      await conn.query("ALTER TABLE amenity_rules DROP COLUMN category");
      console.log("     + Successfully dropped category column from amenity_rules");
    }

    // 5. Add rule_type if not present
    if (!existingCols.has("rule_type")) {
      await conn.query(
        "ALTER TABLE amenity_rules ADD COLUMN rule_type ENUM('TEXT', 'IMAGE', 'PDF') NOT NULL DEFAULT 'TEXT' AFTER title"
      );
      console.log("     + Added rule_type column to amenity_rules");
    }

    // 6. Make content nullable (for pure image / PDF rules)
    try {
      await conn.query("ALTER TABLE amenity_rules MODIFY COLUMN content TEXT NULL");
      console.log("     + Made content column nullable in amenity_rules");
    } catch (e) {
      console.warn("     ! Notice on modifying content column:", e.message);
    }

    // 7. Create new index on (society_id, is_active)
    try {
      await conn.query(
        "ALTER TABLE amenity_rules ADD INDEX idx_amenity_rules_society_active (society_id, is_active)"
      );
      console.log("     + Created updated index idx_amenity_rules_society_active (society_id, is_active)");
    } catch (e) {
      console.warn("     ! Notice on creating index:", e.message);
    }
  },

  async down(conn, isDryRun) {
    if (isDryRun) return;
    const [columns] = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_rules'"
    );
    const existingCols = new Set(columns.map((c) => c.COLUMN_NAME));

    if (!existingCols.has("display_order")) {
      await conn.query("ALTER TABLE amenity_rules ADD COLUMN display_order INT NOT NULL DEFAULT 0");
    }
    if (!existingCols.has("category")) {
      await conn.query("ALTER TABLE amenity_rules ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'GENERAL'");
    }
    if (existingCols.has("rule_type")) {
      await conn.query("ALTER TABLE amenity_rules DROP COLUMN rule_type");
    }
  },
};
