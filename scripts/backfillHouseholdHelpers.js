const sequelize = require("../config/db");
const { HouseHoldMember } = require("../models");
const { Op } = require("sequelize");
const { DAILY_HELP_ROLES } = require("../utils/dailyHelpUtils");

/**
 * Normalizes legacy Daily Help records.
 * Rows that carry a helper role in `relation` but have no `work` value are
 * converted to the canonical shape: work = <role>, relation = 'Daily Help'.
 */
async function runBackfill() {
  try {
    await sequelize.authenticate();
    console.log("DB connected successfully");

    const beforeCount = await HouseHoldMember.count({
      where: {
        work: null,
        relation: { [Op.in]: DAILY_HELP_ROLES },
      },
    });
    console.log(`Found ${beforeCount} helper-role record(s) with work = NULL`);

    if (beforeCount > 0) {
      const [affectedRows] = await HouseHoldMember.update(
        { work: sequelize.col("relation"), relation: "Daily Help" },
        {
          where: {
            work: null,
            relation: { [Op.in]: DAILY_HELP_ROLES },
          },
        }
      );
      console.log(`Backfilled ${affectedRows} record(s) => work=relation, relation='Daily Help'`);
    }

    console.log("Backfill finished successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  }
}

runBackfill();