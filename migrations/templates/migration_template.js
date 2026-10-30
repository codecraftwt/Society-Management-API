const { DataTypes } = require('sequelize');

module.exports = {
  name: 'YYYYMMDDHHMMSS_migration_name.js',
  async up(conn, isDryRun) {
    // Implement forward migration
    // Use isDryRun to skip actual changes
    // Check existence before altering
  },
  async down(conn, isDryRun) {
    // Implement rollback if safe to do so
  }
};
