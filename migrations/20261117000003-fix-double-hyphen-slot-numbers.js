/**
 * Normalizes double hyphens ('--') in slot numbers and assigned spots to single hyphens ('-')
 */
module.exports = {
  name: '20261117000003-fix-double-hyphen-slot-numbers.js',

  async up(conn, isDryRun) {
    console.log('  -> [Fix Slot Numbers] Replacing double hyphens (--) with single hyphens in parking_slots and parking_requests...');
    if (isDryRun) {
      console.log('     [DRY RUN] Would update slot_number and assigned_spot');
      return;
    }

    await conn.query(`
      UPDATE parking_slots 
      SET slot_number = REPLACE(slot_number, '--', '-') 
      WHERE slot_number LIKE '%--%';
    `);

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
