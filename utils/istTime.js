const TIMEZONE = "Asia/Kolkata";

/* ── Current date in IST as YYYY-MM-DD ── */
const getCurrentISTDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });

/* ── Current time in IST as "HH:mm" (24h) ── */
const getCurrentISTTime = () =>
  new Date().toLocaleTimeString("en-IN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/* ── Minutes since midnight in IST (duty math operates on this) ── */
const getCurrentISTMinutes = () => {
  const [h, m] = getCurrentISTTime().split(":").map(Number);
  return h * 60 + m;
};

/* ── Debug-friendly IST timestamp, e.g. 2026-09-23 14:20:00+05:30 ── */
const getCurrentISTDateTime = () => {
  const now = new Date();
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const date = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const time = now.toLocaleTimeString("en-IN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${date} ${time}${sign}${hh}:${mm}`;
};

module.exports = {
  TIMEZONE,
  getCurrentISTDate,
  getCurrentISTTime,
  getCurrentISTMinutes,
  getCurrentISTDateTime,
};