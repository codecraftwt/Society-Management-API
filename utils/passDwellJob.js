const cron          = require("node-cron");
const { Op }        = require("sequelize");
const VisitorLog    = require("../models/VisitorLog");
const Flat          = require("../models/Flat");
const GuardShift    = require("../models/GuardShift");
const Notification  = require("../models/Notification");
const User          = require("../models/User");
const { sendPushNotification } = require("./pushNotification");
const { getCurrentISTDate, getCurrentISTMinutes } = require("./istTime");
const { getShiftTimings, isTimeInShift } = require("./shiftTiming");

const JOB_INTERVAL = "* * * * *"; // every minute

/* ── Resolve the guard currently on duty for a society ── */
const getOnDutyGuard = async (societyId) => {
  const today   = getCurrentISTDate();
  const timings = await getShiftTimings(societyId);
  const minutes = getCurrentISTMinutes();

  const shifts = await GuardShift.findAll({
    where: {
      society_id: societyId,
      start_date: { [Op.lte]: today },
      end_date:   { [Op.gte]: today },
    },
  });

  return shifts.find((s) => isTimeInShift(timings, s.shift_type, minutes)) || null;
};

cron.schedule(JOB_INTERVAL, async () => {
  try {
    const now = new Date();

    // Open visit logs that carry a configured dwell time and have not yet
    // triggered a guard alert. Non-pass entries (dwell_minutes = null) are
    // intentionally skipped — the existing 45-minute radar covers those.
    const openLogs = await VisitorLog.findAll({
      where: {
        exit_time:     null,
        dwell_minutes: { [Op.not]: null },
        dwell_alerted: false,
      },
      include: [
        { model: Flat, attributes: ["flat_number"] },
      ],
      limit: 200,
    });

    const due = openLogs.filter((log) => {
      const entryTime = new Date(log.entry_time).getTime();
      const allowed   = (Number(log.dwell_minutes) > 0 ? Number(log.dwell_minutes) : 45) * 60000;
      return now.getTime() - entryTime >= allowed;
    });

    if (due.length === 0) return;

    console.log(`[passDwellJob] ${due.length} overstaying visitor(s) need guard alert(s).`);

    for (const log of due) {
      // Flag FIRST so a retry can never double-notify this log.
      await log.update({ dwell_alerted: true });

      const guard = await getOnDutyGuard(log.society_id);
      if (!guard) {
        console.log(`[passDwellJob] No guard on duty for society ${log.society_id}`);
        continue;
      }

      const title   = "Visitor Overstay Alert";
      const flatNum = log.Flat?.flat_number;
      const message = `${log.visitor_name} has been inside for more than the allowed ${log.dwell_minutes} minutes${flatNum ? ` (Flat ${flatNum})` : ""}.`;

      try {
        const notification = await Notification.create({
          title,
          message,
          type:             "VISITOR",
          action_type:      "VIEW_VISITOR",
          action_route:     "/guard",
          society_id:       log.society_id,
          receiver_user_id: guard.guard_id,
        });

        if (global.io) {
          global.io.to(`user_${guard.guard_id}`).emit("new_notification", notification);
        }

        const user = await User.findByPk(guard.guard_id, { attributes: ["fcm_token"] });
        if (user?.fcm_token) {
          sendPushNotification(user.fcm_token, title, message, { route: "/guard" }).catch((err) =>
            console.log("Push Error:", err)
          );
        }
      } catch (notifErr) {
        console.error("[passDwellJob] Notification error:", notifErr.message);
      }
    }
  } catch (err) {
    console.error("[passDwellJob] Error:", err.message);
  }
});

console.log("[passDwellJob] Scheduled — runs every minute.");