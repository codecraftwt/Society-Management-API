require("dotenv").config();
const sequelize = require("../config/db");

(async () => {
  try {
    const [results] = await sequelize.query(
      "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitorlogs' AND COLUMN_NAME = 'preapproval_id'"
    );
    if (Number(results[0].c) > 0) {
      console.log("preapproval_id already exists — skipping");
    } else {
      await sequelize.query(
        "ALTER TABLE `visitorlogs` ADD COLUMN `preapproval_id` INT NULL AFTER `exit_time`"
      );
      console.log("Added visitorlogs.preapproval_id");
    }
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();