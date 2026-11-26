"use strict";

const IST_TZ = "Asia/Kolkata";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Convert a Date / ISO string to { year, month, day, iso } in IST calendar time.
 */
function toISTParts(input) {
  if (!input) return null;
  // If already a bare YYYY-MM-DD date string, parse its calendar components directly.
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [y, m, d] = input.trim().split("-").map(Number);
    return { year: y, month: m, day: d, iso: input.trim() };
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;

  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day, iso };
}

/**
 * Add calendar days to an IST { year, month, day } date.
 */
function addCalendarDays(parts, days) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (Number(days) || 0)));
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth() + 1;
  const day = utc.getUTCDate();
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, iso };
}

/**
 * Sum approved waivers for a bill.
 */
function sumWaivers(waivers) {
  if (!Array.isArray(waivers) || waivers.length === 0) return 0;
  return round2(waivers.reduce((acc, w) => acc + Math.max(0, Number(w?.waiver_amount) || 0), 0));
}

/**
 * Deterministic server-side late fee calculation for a bill.
 *
 * @param {Object} bill - Sequelize Bill instance or plain bill object
 * @param {Object} [options]
 * @param {Date|string} [options.asOfDate] - Reference date (defaults to now)
 * @param {Array} [options.waivers] - Array of BillLateFeeWaiver records
 * @param {number} [options.waivedAmount] - Pre-summed waiver amount (overrides options.waivers)
 * @param {Object} [options.settledPayment] - Optional SUCCESS Payment record for PAID bills
 */
function calculateLateFee(bill, options = {}) {
  const baseAmount = round2(bill?.amount ?? bill?.base_amount ?? 0);
  const waivers = options.waivers ?? bill?.lateFeeWaivers ?? [];
  const rawWaived =
    options.waivedAmount !== undefined && options.waivedAmount !== null
      ? round2(Math.max(0, Number(options.waivedAmount) || 0))
      : sumWaivers(waivers);

  // If the bill is already settled (PAID), never accrue new late fees.
  if (String(bill?.status || "").toUpperCase() === "PAID") {
    const settled = options.settledPayment;
    const settledLateFee = settled ? round2(Number(settled.late_fee_amount) || 0) : 0;
    const settledWaived = settled ? round2(Number(settled.waived_amount) || rawWaived) : rawWaived;
    const settledTotal = settled && settled.amount != null ? round2(settled.amount) : round2(baseAmount + settledLateFee);

    return {
      baseAmount,
      overdueMonths: 0,
      calculatedLateFee: round2(settledLateFee + settledWaived),
      waivedAmount: settledWaived,
      outstandingLateFee: settledLateFee,
      totalPayable: settledTotal,
      isOverdue: false,
    };
  }

  const enabled = Boolean(bill?.late_fee_enabled);
  const feeValue = round2(Number(bill?.late_fee_value) || 0);
  const feeType = String(bill?.late_fee_type || "FIXED_PER_MONTH").toUpperCase();
  const graceDays = Math.max(0, parseInt(bill?.late_fee_grace_days ?? 0, 10) || 0);
  const maxFee =
    bill?.late_fee_max_amount !== undefined && bill?.late_fee_max_amount !== null && bill?.late_fee_max_amount !== ""
      ? round2(Math.max(0, Number(bill.late_fee_max_amount) || 0))
      : null;

  const dueParts = toISTParts(bill?.due_date || bill?.last_pay_date);
  const asOfParts = toISTParts(options.asOfDate || new Date());

  if (!enabled || feeValue <= 0 || !dueParts || !asOfParts) {
    return {
      baseAmount,
      overdueMonths: 0,
      calculatedLateFee: 0,
      waivedAmount: rawWaived,
      outstandingLateFee: 0,
      totalPayable: baseAmount,
      isOverdue: Boolean(dueParts && asOfParts && asOfParts.iso > dueParts.iso),
    };
  }

  const cutoffParts = addCalendarDays(dueParts, graceDays);
  const isPastDue = asOfParts.iso > dueParts.iso;
  const isPastCutoff = asOfParts.iso > cutoffParts.iso;

  if (!isPastCutoff) {
    return {
      baseAmount,
      overdueMonths: 0,
      calculatedLateFee: 0,
      waivedAmount: rawWaived,
      outstandingLateFee: 0,
      totalPayable: baseAmount,
      isOverdue: isPastDue,
    };
  }

  // Calendar-month difference from effective cutoff date (due_date + grace_days).
  // - If cutoff is the last day of its month (e.g. 30 June), first penalty starts in July (1), Aug (2), Sep (3).
  // - If cutoff is mid-month (e.g. 11 Dec), remaining days in Dec (12–31 Dec) are month 1, Jan is 2, Feb is 3.
  const daysInCutoffMonth = new Date(Date.UTC(cutoffParts.year, cutoffParts.month, 0)).getUTCDate();
  const startsInCutoffMonth = cutoffParts.day < daysInCutoffMonth;
  const rawMonthDiff = (asOfParts.year - cutoffParts.year) * 12 + (asOfParts.month - cutoffParts.month);
  const overdueMonths = Math.max(1, startsInCutoffMonth ? rawMonthDiff + 1 : rawMonthDiff);

  let calculatedLateFee = 0;
  if (feeType === "FIXED_ONE_TIME") {
    calculatedLateFee = feeValue;
  } else if (feeType === "PERCENT_PER_MONTH") {
    // Compounding: increase previous month's outstanding amount by feeValue% each overdue month.
    const compoundedTotal = round2(baseAmount * Math.pow(1 + feeValue / 100, overdueMonths));
    calculatedLateFee = Math.max(0, round2(compoundedTotal - baseAmount));
  } else {
    // FIXED_PER_MONTH (default)
    calculatedLateFee = round2(feeValue * overdueMonths);
  }

  if (maxFee !== null) {
    calculatedLateFee = Math.min(calculatedLateFee, maxFee);
  }

  const effectiveWaived = Math.min(rawWaived, calculatedLateFee);
  const outstandingLateFee = Math.max(0, round2(calculatedLateFee - effectiveWaived));
  const totalPayable = round2(baseAmount + outstandingLateFee);

  return {
    baseAmount,
    overdueMonths,
    calculatedLateFee,
    waivedAmount: round2(rawWaived),
    outstandingLateFee,
    totalPayable,
    isOverdue: true,
  };
}

/**
 * Snake_case API response fields for bill listings & details.
 */
function buildBillLateFeeFields(bill, options = {}) {
  const calc = calculateLateFee(bill, options);
  return {
    base_amount: calc.baseAmount,
    late_fee: calc.outstandingLateFee,
    calculated_late_fee: calc.calculatedLateFee,
    waived_amount: calc.waivedAmount,
    total_payable: calc.totalPayable,
    overdue_months: calc.overdueMonths,
    is_overdue: calc.isOverdue,
  };
}

module.exports = {
  calculateLateFee,
  buildBillLateFeeFields,
  toISTParts,
  addCalendarDays,
  sumWaivers,
  round2,
};
