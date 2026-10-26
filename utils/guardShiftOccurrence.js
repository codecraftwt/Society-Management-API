const { TIMEZONE, getCurrentISTDate } = require("./istTime");
const { DEFAULT_TIMINGS, toMinutes } = require("./shiftTiming");

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

const toISODate = (value) => {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};

const addDays = (isoDate, days) => {
  const [year, month, day] = toISODate(isoDate).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return next.toISOString().slice(0, 10);
};

const istLocalToUtc = (isoDate, hhmm) => {
  const [year, month, day] = toISODate(isoDate).split("-").map(Number);
  const [hour, minute] = String(hhmm).split(":").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour || 0, minute || 0) - IST_OFFSET_MINUTES * 60 * 1000
  );
};

const getTiming = (timings, shiftType) =>
  timings?.[shiftType] || DEFAULT_TIMINGS[shiftType] || DEFAULT_TIMINGS.MORNING;

const getOccurrenceWindow = (shift, timings, occurrenceDate) => {
  const date = toISODate(occurrenceDate);
  const timing = getTiming(timings, shift?.shift_type);
  const endDate =
    toMinutes(timing.end) <= toMinutes(timing.start) ? addDays(date, 1) : date;

  return {
    occurrence_date: date,
    start_time: timing.start,
    end_time: timing.end,
    start: istLocalToUtc(date, timing.start),
    end: istLocalToUtc(endDate, timing.end),
  };
};

const getShiftOccurrenceAt = (shift, timings, at = new Date()) => {
  const startDate = toISODate(shift?.start_date);
  const endDate = toISODate(shift?.end_date);
  if (!startDate || !endDate) return null;

  const atMs = new Date(at).getTime();
  const today = getCurrentISTDate();
  const candidateDates = [addDays(today, -1), today];

  for (const occurrenceDate of candidateDates) {
    if (occurrenceDate < startDate || occurrenceDate > endDate) continue;
    const window = getOccurrenceWindow(shift, timings, occurrenceDate);
    if (atMs >= window.start.getTime() && atMs < window.end.getTime()) {
      return window;
    }
  }

  return null;
};

const getShiftOccurrenceForDate = (shift, timings, occurrenceDate) => {
  const date = toISODate(occurrenceDate);
  const startDate = toISODate(shift?.start_date);
  const endDate = toISODate(shift?.end_date);
  if (!date || !startDate || !endDate || date < startDate || date > endDate) return null;
  return getOccurrenceWindow(shift, timings, date);
};

const isShiftOnOccurrenceDate = (shift, occurrenceDate) => {
  const date = toISODate(occurrenceDate);
  const startDate = toISODate(shift?.start_date);
  const endDate = toISODate(shift?.end_date);
  return Boolean(date && startDate && endDate && date >= startDate && date <= endDate);
};

module.exports = {
  TIMEZONE,
  toISODate,
  addDays,
  istLocalToUtc,
  getOccurrenceWindow,
  getShiftOccurrenceAt,
  getShiftOccurrenceForDate,
  isShiftOnOccurrenceDate,
};
