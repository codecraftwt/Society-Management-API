/**
 * Normalizes double hyphens ('--') in slot numbers and assigned spots to single hyphens ('-')
 */
module.exports = {
  name: '20261117000003-fix-double-hyphen-slot-numbers.js',

  async up(conn, isDryRun) {
    console.log('  -> [Fix Slot Numbers] Replacing double hyphens (--) with single hyphens in parking_slots and parking_requests...');
    if (isDryRun) {
      console.log('     [DRY RUN] Would safely normalize slot_number and assigned_spot');
      return;
    }

    const [slotRows] = await conn.query(`
      SELECT id, society_id, slot_number
      FROM parking_slots
      WHERE slot_number LIKE '%--%';
    `);

    let updatedSlots = 0;
    let skippedSlots = 0;
    for (const row of slotRows) {
      const normalized = String(row.slot_number).replace(/--+/g, '-');
      if (normalized === row.slot_number) continue;

      const [existing] = await conn.query(
        'SELECT id FROM parking_slots WHERE society_id = ? AND slot_number = ? AND id <> ? LIMIT 1',
        [row.society_id, normalized, row.id]
      );

      if (existing.length > 0) {
        skippedSlots++;
        console.log(
          `     [Fix Slot Numbers] Skipping parking_slots.id=${row.id} (${row.slot_number} -> ${normalized}) because society_id=${row.society_id} already has id=${existing[0].id}`
        );
        continue;
      }

      await conn.query('UPDATE parking_slots SET slot_number = ? WHERE id = ?', [normalized, row.id]);
      updatedSlots++;
    }
    console.log(`     [Fix Slot Numbers] parking_slots updated=${updatedSlots}, skipped_duplicates=${skippedSlots}`);

    await conn.query(`
      UPDATE parking_requests 
      SET assigned_spot = REPLACE(assigned_spot, '--', '-') 
      WHERE assigned_spot LIKE '%--%';
    `);
  },

  async down(conn, isDryRun) {
    // Irreversible data cleanup
  }
};
