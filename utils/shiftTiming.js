const { GuardShiftTiming } = require("../models");
const { getCurrentISTMinutes } = require("./istTime");

const SHIFT_TYPES = ["MORNING", "AFTERNOON", "NIGHT"];

/* Society defaults — used whenever a timing row is missing so that every
   controller agrees before any config has been saved. */
const DEFAULT_TIMINGS = {
  MORNING:   { start: "08:00", end: "16:00" },
  AFTERNOON: { start: "16:00", end: "00:00" },
  NIGHT:     { start: "00:00", end: "08:00" },
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

const isValidHHmm = (value) =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/* Normalize a raw DB row/object into { start, end } in minutes or "HH:mm". */
const normalizeEntries = (rows) => {
  const out = {};
  for (const type of SHIFT_TYPES) {
    const row = (rows || []).find(
      (r) => String(r.shift_type).toUpperCase() === type
    );
    out[type] = row
      ? { start: row.start_time, end: row.end_time }
      : { ...DEFAULT_TIMINGS[type] };
  }
  return out;
};

/* ── Fetch society timings (falls back to defaults per missing row) ── */
const getShiftTimings = async (societyId) => {
  const rows = await GuardShiftTiming.findAll({
    where: { society_id: societyId },
  });
  return normalizeEntries(rows);
};

/* ── True if `minutes` (0-1439) falls inside [start, end).
       Overnight windows (start > end) wrap past midnight. ── */
const isMinuteInWindow = (minutes, start, end) => {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true; // 24h continuous duty
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e; // overnight wrap
};

/* ── Current shift type given timings + current IST minutes ── */
const getCurrentShiftTypeFromTimings = (timings, minutes = getCurrentISTMinutes()) => {
  for (const type of SHIFT_TYPES) {
    const t = timings[type];
    if (t && isMinuteInWindow(minutes, t.start, t.end)) return type;
  }
  /* No window matched (shouldn't normally happen) — find closest start. */
  let best = "NIGHT";
  let bestStart = -1;
  for (const type of SHIFT_TYPES) {
    const start = toMinutes(timings[type]?.start ?? DEFAULT_TIMINGS[type].start);
    if (start > bestStart) {
      bestStart = start;
      best = type;
    }
  }
  return best;
};

/* ── Is `type` currently active given timings + current IST minutes? ── */
const isTimeInShift = (timings, type, minutes = getCurrentISTMinutes()) => {
  const t = timings[type] || DEFAULT_TIMINGS[type];
  return isMinuteInWindow(minutes, t.start, t.end);
};

/* Validate: 3 typed entries, valid HH:mm, and mutually non-overlapping
   windows ([start, end) on a 24h circle). Throws on first failure. */
const validateTimingsConfig = (input) => {
  if (!input || typeof input !== "object") {
    throw new Error("Guard shift timings are required.");
  }

  const entries = {};
  for (const type of SHIFT_TYPES) {
    const e = input[type] || {};
    const start = e.start_time ?? e.start;
    const end = e.end_time ?? e.end;
    if (!isValidHHmm(start) || !isValidHHmm(end)) {
      throw new Error(
        `${type} shift requires valid start_time and end_time (HH:mm).`
      );
    }
    entries[type] = { start, end };
  }

  /* Reject overlapping windows — otherwise duty becomes ambiguous. */
  for (let i = 0; i < SHIFT_TYPES.length; i++) {
    const a = entries[SHIFT_TYPES[i]];
    for (let j = i + 1; j < SHIFT_TYPES.length; j++) {
      const b = entries[SHIFT_TYPES[j]];
      if (
        isMinuteInWindow(toMinutes(b.start), a.start, a.end) ||
        isMinuteInWindow(toMinutes(a.start), b.start, b.end)
      ) {
        throw new Error(
          `${SHIFT_TYPES[i]} and ${SHIFT_TYPES[j]} shift windows must not overlap.`
        );
      }
    }
  }

  return entries;
};

module.exports = {
  SHIFT_TYPES,
  DEFAULT_TIMINGS,
  toMinutes,
  isValidHHmm,
  getShiftTimings,
  getCurrentShiftTypeFromTimings,
  isTimeInShift,
  validateTimingsConfig,
};