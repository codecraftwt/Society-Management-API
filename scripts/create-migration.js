// Migration creation helper
const fs = require('fs');
const path = require('path');

function createMigration(name) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name}.js`;
  const templatePath = path.join(__dirname, '../migrations/templates/migration_template.js');
  const targetPath = path.join(__dirname, '../migrations', filename);
  
  let template = fs.readFileSync(templatePath, 'utf8');
  template = template.replace('YYYYMMDDHHMMSS_migration_name.js', filename);
  
  fs.writeFileSync(targetPath, template);
  console.log(`Created migration: ${filename}`);
  return filename;
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: node scripts/create-migration.js <migration_name>');
    process.exit(1);
  }
  createMigration(name);
}

module.exports = { createMigration };
