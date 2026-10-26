const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isGuardAttendanceAutomationEnabled = () =>
  TRUE_VALUES.has(String(process.env.GUARD_ATTENDANCE_AUTOMATION_ENABLED || "").toLowerCase());

const getGuardAttendanceAutomationConfig = () => ({
  enabled: isGuardAttendanceAutomationEnabled(),
  startReminderAfterMinutes: toPositiveNumber(
    process.env.GUARD_START_REMINDER_AFTER_MINUTES,
    5
  ),
  shiftEndResponseMinutes: toPositiveNumber(
    process.env.GUARD_SHIFT_END_RESPONSE_MINUTES,
    2
  ),
  holdMinutes: toPositiveNumber(process.env.GUARD_SHIFT_END_HOLD_MINUTES, 10),
});

module.exports = {
  isGuardAttendanceAutomationEnabled,
  getGuardAttendanceAutomationConfig,
};
