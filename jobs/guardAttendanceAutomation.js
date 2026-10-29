const cron = require("node-cron");
const { Op } = require("sequelize");
const {
  GuardAttendance,
  GuardShift,
  Society,
  User,
} = require("../models");
const { getShiftTimings } = require("../utils/shiftTiming");
const { getShiftOccurrenceForDate } = require("../utils/guardShiftOccurrence");
const { getCurrentISTDateTime } = require("../utils/istTime");
const {
  isGuardAttendanceAutomationEnabled,
  getGuardAttendanceAutomationConfig,
} = require("../utils/guardAttendanceAutomation");
const { sendNotification } = require("../services/notificationService");

let isRunning = false;

const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * 60 * 1000);

const getGuardUser = async (guardId) => {
  return User.findByPk(guardId, {
    attributes: ["id", "society_id", "fcm_token", "role", "status", "name"],
  });
};

const shouldAutoClose = (attendance, now) => {
  if (!attendance || attendance.status !== "PUNCHED_IN" || attendance.punch_out) {
    return false;
  }
  if (!attendance.scheduled_end_at) {
    return false;
  }
  // The scheduled end is always a hard safety boundary. A response/hold may
  // extend it only through the explicit auto-punch-out deadline.
  const dueAt = attendance.auto_punch_out_due_at
    ? new Date(attendance.auto_punch_out_due_at)
    : new Date(attendance.scheduled_end_at);
  return now >= dueAt;
};

const runGuardAttendanceAutomation = async () => {
  if (isRunning) return;
  if (!isGuardAttendanceAutomationEnabled()) return;
  isRunning = true;

  const sequelize = require("../config/db");
  const lockName = "guard_attendance_automation_tick";
  let acquired = false;

  try {
    const [[lockRow]] = await sequelize.query("SELECT GET_LOCK(:lockName, 0) AS acquired", {
      replacements: { lockName },
    });
    acquired = Number(lockRow?.acquired) === 1;
    if (!acquired) return;

    const config = getGuardAttendanceAutomationConfig();
    const now = new Date();

    const openAttendances = await GuardAttendance.findAll({
      where: {
        status: "PUNCHED_IN",
        punch_out: { [Op.is]: null },
        scheduled_end_at: { [Op.ne]: null },
        is_manual: { [Op.ne]: true },
      },
      include: [
        { model: GuardShift, as: "shift" },
        { model: Society, as: "society", attributes: ["id", "name"] },
      ],
    });

    for (const attendance of openAttendances) {
      try {
        const shift = attendance.shift;
        if (!shift) continue;
        const societyId = attendance.society_id;
        const timings = societyId ? await getShiftTimings(societyId) : {};
        const occurrence = getShiftOccurrenceForDate(shift, timings, attendance.attendance_date);
        if (!occurrence) {
          console.warn(
            `[GuardAttendanceAutomation] Skipping attendance ${attendance.id}: could not resolve occurrence for ${attendance.attendance_date}`
          );
          continue;
        }

        if (!attendance.shift_end_notified_at) {
          // Notify when the scheduled shift actually ends. The guard then has
          // the configured hold window to punch out or acknowledge that they
          // are still working.
          const notifyAt = occurrence.end;
          if (now >= notifyAt) {
            const guardUser = await getGuardUser(attendance.guard_id);
            if (!guardUser) continue;
            const sourceEventId = `GUARD_SHIFT_END:${attendance.id}`;
            await sendNotification({
              societyId: attendance.society_id,
              receiverUserId: attendance.guard_id,
              title: "Shift ending soon",
              message: `Your shift ended at ${occurrence.end_time}. You have ${config.holdMinutes} minutes to punch out or choose "Still working".`,
              type: "GUARD_ATTENDANCE",
              actionType: "VIEW_GUARD_ATTENDANCE",
              actionRoute: "GuardHome",
              receiverRole: "GUARD",
              fcmToken: guardUser.fcm_token,
              sourceEventId,
              extraData: {
                attendance_id: String(attendance.id),
                action_type: "VIEW_GUARD_ATTENDANCE",
              },
            });

            // Persist the deadline only after notification persistence succeeds.
            // A failed notification is retried on the next automation tick.
            await GuardAttendance.update(
              {
                shift_end_notified_at: new Date(),
                auto_punch_out_due_at: addMinutes(occurrence.end, config.holdMinutes),
              },
              {
                where: {
                  id: attendance.id,
                  status: "PUNCHED_IN",
                  punch_out: { [Op.is]: null },
                  shift_end_notified_at: { [Op.is]: null },
                },
              }
            );
          }
          continue;
        }

        if (shouldAutoClose(attendance, now)) {
          const [updatedCount] = await GuardAttendance.update(
            {
              // Auto punch-out sets punch_out to the scheduled shift end time,
              // while auto_punch_out_at records the actual execution timestamp.
              punch_out: attendance.scheduled_end_at,
              worked_minutes: Math.max(
                0,
                Math.round(
                  (new Date(attendance.scheduled_end_at).getTime() - new Date(attendance.punch_in).getTime()) / 60000
                )
              ),
              status: "PUNCHED_OUT",
              is_auto_punch_out: true,
              auto_punch_out_at: now,
              auto_punch_out_reason: attendance.acknowledged_at ? "HOLD_EXPIRED" : "NO_RESPONSE",
              punch_out_source: "SYSTEM",
            },
            {
              where: {
                id: attendance.id,
                status: "PUNCHED_IN",
                punch_out: { [Op.is]: null },
                scheduled_end_at: { [Op.ne]: null },
                is_manual: { [Op.ne]: true },
              },
            }
          );

          if (updatedCount) {
            const guardUser = await getGuardUser(attendance.guard_id);
            if (guardUser) {
              const sourceEventId = `GUARD_AUTO_CLOSE:${attendance.id}`;
              await sendNotification({
                societyId: attendance.society_id,
                receiverUserId: attendance.guard_id,
                title: "Auto punch-out completed",
                message: "You were auto-punched out at your scheduled shift end time.",
                type: "GUARD_ATTENDANCE",
                actionType: "VIEW_GUARD_ATTENDANCE",
                actionRoute: "GuardHome",
                receiverRole: "GUARD",
                fcmToken: guardUser.fcm_token,
                sourceEventId,
                extraData: {
                  attendance_id: String(attendance.id),
                  action_type: "VIEW_GUARD_ATTENDANCE",
                },
              });
            }
          }
        }
      } catch (attendanceErr) {
        console.error(`[GuardAttendanceAutomation] Failed for attendance ${attendance.id}:`, attendanceErr.message);
      }
    }

  } catch (err) {
    console.error("[GuardAttendanceAutomation] Tick failed:", err.message);
  } finally {
    if (acquired) {
      try {
        await sequelize.query("SELECT RELEASE_LOCK(:lockName)", {
          replacements: { lockName },
        });
      } catch (_) {}
    }
    isRunning = false;
  }
};

const startGuardAttendanceAutomationJob = () => {
  if (!isGuardAttendanceAutomationEnabled()) {
    console.log("[GuardAttendanceAutomation] Disabled by GUARD_ATTENDANCE_AUTOMATION_ENABLED=false");
    return;
  }

  runGuardAttendanceAutomation();
  cron.schedule("* * * * *", runGuardAttendanceAutomation, {
    timezone: "Asia/Kolkata",
  });
  console.log("[GuardAttendanceAutomation] Cron started (every minute, Asia/Kolkata)");
};

module.exports = {
  runGuardAttendanceAutomation,
  startGuardAttendanceAutomationJob,
};
