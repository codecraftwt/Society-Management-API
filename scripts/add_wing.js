const sequelize = require('../config/db');

async function run() {
  try {
    const [cols] = await sequelize.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parking_slots' AND COLUMN_NAME = 'wing'"
    );
    if (cols.length === 0) {
      await sequelize.query("ALTER TABLE parking_slots ADD COLUMN wing VARCHAR(255) NULL");
      console.log("Column 'wing' added to parking_slots");
    } else {
      console.log("Column 'wing' already exists");
    }
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    process.exit(0);
  }
}

run();
