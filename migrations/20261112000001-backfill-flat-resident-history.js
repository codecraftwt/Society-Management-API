"use strict";

module.exports = {
  async up(conn) {
    // 1. Backfill from FlatMemberships where is_current = 1
    await conn.query(`
      INSERT INTO resident_history (flat_id, user_id, move_in_date, is_current, created_at)
      SELECT fm.flat_id, fm.user_id, COALESCE(fm.move_in_date, NOW()), 1, NOW()
      FROM FlatMemberships fm
      LEFT JOIN resident_history rh ON rh.flat_id = fm.flat_id AND rh.user_id = fm.user_id
      WHERE fm.is_current = 1
        AND fm.user_id IS NOT NULL
        AND rh.id IS NULL
    `);

    // 2. Backfill from flats.resident_id where not in resident_history
    await conn.query(`
      INSERT INTO resident_history (flat_id, user_id, move_in_date, is_current, created_at)
      SELECT f.id, f.resident_id, COALESCE(f.created_at, NOW()), 1, NOW()
      FROM flats f
      LEFT JOIN resident_history rh ON rh.flat_id = f.id AND rh.user_id = f.resident_id
      WHERE f.resident_id IS NOT NULL
        AND rh.id IS NULL
    `);
  },

  async down(conn) {
    // No-op for backfill
  },
};

