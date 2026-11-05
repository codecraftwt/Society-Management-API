"use strict";

module.exports = {
  async up(conn) {
    const [columns] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'");
    const existing = new Set(columns.map((c) => c.COLUMN_NAME));
    const additions = [
      ["receipt_file_name", "VARCHAR(255) NULL"],
      ["receipt_mime_type", "VARCHAR(100) NULL"],
      ["receipt_file_size", "INT NULL"],
      ["receipt_public_id", "VARCHAR(500) NULL"],
    ];
    for (const [name, definition] of additions) {
      if (!existing.has(name)) await conn.query(`ALTER TABLE expenses ADD COLUMN ${name} ${definition}`);
    }
  },
};
