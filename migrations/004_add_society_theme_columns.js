/** Add the columns used by the society theme/branding API. */
module.exports.up = async function up(conn, isDryRun = false) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'societies'"
  );
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  const additions = [
    ["primary_color", "VARCHAR(20) NULL DEFAULT NULL"],
    ["accent_color", "VARCHAR(20) NULL DEFAULT NULL"],
    ["card_style", "VARCHAR(50) NULL DEFAULT 'default'"],
    ["quick_link_style", "VARCHAR(50) NULL DEFAULT 'default'"],
    ["logo_url", "VARCHAR(500) NULL DEFAULT NULL"],
    ["logo_public_id", "VARCHAR(255) NULL DEFAULT NULL"],
    ["theme_updated_by", "INT NULL DEFAULT NULL"],
    ["theme_updated_at", "DATETIME NULL DEFAULT NULL"],
  ];

  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      console.log(`[Migration] ${isDryRun ? "Would add" : "Adding"} societies.${name}`);
      if (!isDryRun) {
        await conn.query(`ALTER TABLE societies ADD COLUMN ${name} ${definition}`);
      }
    }
  }
};
