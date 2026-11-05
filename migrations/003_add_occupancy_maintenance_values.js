module.exports = {
  name: '003_add_occupancy_maintenance_values.js',
  async up(conn, isDryRun) {
    if (isDryRun) return;
    const columns = [
      ['owner_amount', 'DECIMAL(10,2) NULL'],
      ['tenant_amount', 'DECIMAL(10,2) NULL'],
      ['owner_rate_per_sqft', 'DECIMAL(10,4) NULL'],
      ['tenant_rate_per_sqft', 'DECIMAL(10,4) NULL'],
    ];
    for (const [name, definition] of columns) {
      const [rows] = await conn.query(`SHOW COLUMNS FROM MaintenanceRates LIKE '${name}'`);
      if (!rows.length) await conn.query(`ALTER TABLE MaintenanceRates ADD COLUMN ${name} ${definition}`);
    }
  },
  async down(conn) {
    for (const name of ['owner_amount', 'tenant_amount', 'owner_rate_per_sqft', 'tenant_rate_per_sqft']) {
      const [rows] = await conn.query(`SHOW COLUMNS FROM MaintenanceRates LIKE '${name}'`);
      if (rows.length) await conn.query(`ALTER TABLE MaintenanceRates DROP COLUMN ${name}`);
    }
  },
};
