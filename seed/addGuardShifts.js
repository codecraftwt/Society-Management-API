/**
 * Create MORNING + AFTERNOON shifts for a guard for the next 7 days.
 * Usage: node seed/addGuardShifts.js [email] [days]
 * Defaults: gaurd@yopmail.com, 7 days (inclusive of today)
 */
require("dotenv").config();

const sequelize = require("../config/db");
const { QueryTypes } = require("sequelize");
const GuardShift = require("../models/GuardShift");

(async () => {
  const email = process.argv[2] || "gaurd@yopmail.com";
  const days = parseInt(process.argv[3], 10) || 7;

  try {
    const users = await sequelize.query(
      "SELECT id, name, society_id FROM users WHERE email = :email LIMIT 1",
      { replacements: { email }, type: QueryTypes.SELECT }
    );

    if (!users.length) {
      console.log(`❌ No user found with email ${email}`);
      process.exit(1);
    }

    const guard = users[0];
    console.log(`👤 Guard: ${guard.name} (id=${guard.id}, society=${guard.society_id})`);

    const fmt = (d) => d.toISOString().split("T")[0];
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (days - 1));

    for (const shiftType of ["MORNING", "AFTERNOON"]) {
      const existing = await GuardShift.findOne({
        where: {
          guard_id: guard.id,
          society_id: guard.society_id,
          shift_type: shiftType,
        },
      });

      if (existing) {
        await existing.update({ start_date: fmt(today), end_date: fmt(endDate) });
        console.log(`♻️  ${shiftType}: updated ${existing.start_date} → ${fmt(endDate)}`);
      } else {
        await GuardShift.create({
          guard_id: guard.id,
          society_id: guard.society_id,
          shift_type: shiftType,
          start_date: fmt(today),
          end_date: fmt(endDate),
        });
        console.log(`✅ ${shiftType}: created ${fmt(today)} → ${fmt(endDate)}`);
      }
    }

    const all = await GuardShift.findAll({ where: { guard_id: guard.id } });
    console.table(
      all.map((s) => ({
        id: s.id,
        type: s.shift_type,
        start: s.start_date,
        end: s.end_date,
      }))
    );
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
