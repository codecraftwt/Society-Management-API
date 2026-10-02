const crypto = require("crypto");
const { getCurrentISTDate } = require("./istTime");

/* ═══════════════════════════════════════════════════════════════════════════
   CLEANING STAFF — shared constants and pure helpers.

   Everything here is deliberately side-effect free (no DB, no req/res) so the
   rules can be unit-tested directly and reused by the controller and any future
   job/report without importing controller code.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Fixed gate rule: first scan is IN, second is OUT. Never client-controlled. */
const MAX_SCANS_PER_DAY = 2;

const STAFF_STATUSES = ["ACTIVE", "INACTIVE"];
const PASS_STATUSES = ["ACTIVE", "EXPIRED", "REVOKED"];
const ASSIGNMENT_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];
const WORK_TYPES = ["DAILY", "SHIFT", "ONCE"];
const SHIFTS = ["MORNING", "EVENING", "FULL_DAY"];

const PASS_CODE_PREFIX = "GP-";
const PASS_CODE_PATTERN = /^GP-\d{6}$/i;

/**
 * Generate a `GP-XXXXXX` 6-digit integer pass code (e.g. "GP-812696"),
 * matching the standard gate pass format used in Household and Visitor passes.
 *
 * @returns {string} e.g. "GP-812696"
 */
const generatePassCode = () => {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${PASS_CODE_PREFIX}${num}`;
};

const isValidPassCode = (code) =>
  typeof code === "string" && PASS_CODE_PATTERN.test(code.trim());

/**
 * Normalize a scanned/entered pass code to the canonical stored form.
 * Returns null when the value cannot possibly be a cleaning staff pass, so the
 * caller can answer with a plain "invalid pass" instead of hitting the DB.
 */
const normalizePassCode = (code) => {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return isValidPassCode(trimmed) ? trimmed : null;
};

/**
 * Inclusive day range check: is `day` within [start..end]?
 * An empty `end` means "no upper bound" (open-ended assignment/pass).
 */
const isDateInRange = (day, start, end) => {
  if (!day || !start) return false;
  if (day < start) return false;
  if (end && day > end) return false;
  return true;
};

/**
 * Does a proposed [newStart..newEnd] window overlap an existing one?
 * Mirrors the guard-shift overlap rule so both features behave identically.
 *
 * NOTE: a null `end` means UNBOUNDED here. That is correct for assignments
 * (a permanent block posting genuinely never ends) but wrong for passes, where
 * a null end means "this single day only". Passes must use
 * `passRange`/`passesOverlap` below instead.
 */
const datesOverlap = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !bStart) return false;
  const aEndOrInfinity = aEnd || "9999-12-31";
  const bEndOrInfinity = bEnd || "9999-12-31";
  return aStart <= bEndOrInfinity && aEndOrInfinity >= bStart;
};

/**
 * The inclusive day range a pass actually covers.
 *
 * A pass with no `valid_until` is a ONE-DAY pass: it covers [valid_date,
 * valid_date] and nothing else. Treating the missing end as unbounded would make
 * every single-day pass collide with all later passes forever, which is exactly
 * the bug this helper exists to prevent.
 *
 * @param {{valid_date: string, valid_until?: string|null}} pass
 * @returns {{start: string, end: string}}
 */
const passRange = (pass) => ({
  start: pass?.valid_date,
  end: pass?.valid_until || pass?.valid_date,
});

/**
 * Do two pass windows share at least one day?
 * Handles both the existing row and the proposed [start, end] pair.
 */
const passesOverlap = (existing, proposedStart, proposedEnd) => {
  const existingRange = passRange(existing);
  const proposedRange = { start: proposedStart, end: proposedEnd || proposedStart };
  return datesOverlap(existingRange.start, existingRange.end, proposedRange.start, proposedRange.end);
};

/**
 * Minutes worked between two timestamps, rounded down and floored at 0.
 * Returns null when the pair is incomplete or inverted so the caller can leave
 * worked_minutes null instead of storing a misleading number.
 */
const calculateWorkedMinutes = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null;
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return null;
  const diff = Math.floor((outMs - inMs) / 60000);
  return diff > 0 ? diff : 0;
};

/**
 * Which scan comes next for today's attendance row.
 *
 * Returns one of:
 *  - "IN"        no check_in yet            → first scan of the day
 *  - "OUT"       check_in present, no out   → second (and final) scan
 *  - "COMPLETED" both present               → no scans left, reject
 *
 * @param {{check_in: Date|null, check_out: Date|null}} attendance
 */
const resolveScanDirection = (attendance) => {
  if (!attendance || !attendance.check_in) return "IN";
  if (!attendance.check_out) return "OUT";
  return "COMPLETED";
};

/** Scans already consumed today, derived from the stored scan_count. */
const remainingScans = (attendance) => {
  const used = Number(attendance?.scan_count || 0);
  return Math.max(0, MAX_SCANS_PER_DAY - used);
};

/**
 * Is this pass usable for gate entry *right now*?
 *
 * Split into the two questions the gate UI needs to explain itself:
 *  - `usableForEntry` — required to record IN.
 *  - `usableForExit`  — an already-valid IN is always closable, even if the
 *    pass has since expired or been revoked. Staff must never be trapped inside
 *    because a pass lapsed while they were on site.
 *
 * @param {object} pass  CleaningStaffPass row
 * @param {string} today IST calendar date (YYYY-MM-DD)
 */
const evaluatePassUsability = (pass, today = getCurrentISTDate()) => {
  if (!pass) {
    return {
      usableForEntry: false,
      usableForExit: false,
      code: "PASS_NOT_FOUND",
      message: "Invalid cleaning staff pass code.",
    };
  }

  const status = String(pass.status || "").toUpperCase();

  if (status === "REVOKED") {
    return {
      usableForEntry: false,
      usableForExit: false,
      code: "PASS_REVOKED",
      message: "This cleaning staff pass has been revoked.",
    };
  }

  const notStartedYet = today < pass.valid_date;
  const lapsed = Boolean(pass.valid_until && today > pass.valid_until);

  if (status === "EXPIRED" || lapsed) {
    return {
      usableForEntry: false,
      usableForExit: false,
      code: "PASS_EXPIRED",
      message: lapsed
        ? `This cleaning staff pass expired on ${pass.valid_until}.`
        : "This cleaning staff pass has expired.",
    };
  }

  if (notStartedYet) {
    return {
      usableForEntry: false,
      usableForExit: false,
      code: "PASS_NOT_YET_VALID",
      message: `This cleaning staff pass is not active yet. It is valid from ${pass.valid_date}.`,
    };
  }

  return { usableForEntry: true, usableForExit: true, code: null, message: null };
};

module.exports = {
  MAX_SCANS_PER_DAY,
  STAFF_STATUSES,
  PASS_STATUSES,
  ASSIGNMENT_STATUSES,
  WORK_TYPES,
  SHIFTS,
  PASS_CODE_PREFIX,
  PASS_CODE_PATTERN,
  generatePassCode,
  isValidPassCode,
  normalizePassCode,
  isDateInRange,
  datesOverlap,
  passRange,
  passesOverlap,
  calculateWorkedMinutes,
  resolveScanDirection,
  remainingScans,
  evaluatePassUsability,
};