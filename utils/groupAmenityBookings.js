/**
 * Group amenity booking rows by booking.
 *
 * NEW (single-row per booking):
 *   One booking already has from_date/to_date/slots. If the row has a
 *   booking_ids array (from admin grouping), it is a consolidated record.
 *   Otherwise, pass it through directly.
 *
 * LEGACY (multi-row per booking — fallback):
 *   Full-Day rows  → grouped by amenity_id + status, merged into a date range.
 *   Slot rows      → grouped by amenity_id + status + date + user + flat, then
 *                     contiguous slots (start_time == previous end_time) are
 *                     merged into a single time range.
 */

const isFullDay = (b) => !b.start_time || b.start_time === "00:00:00";

const toMin = (t) => {
  if (!t) return 0;
  const p = String(t).split(":");
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
};

const plain = (b) => (b && b.get ? b.get({ plain: true }) : { ...b });

/**
 * @param {Array<object>} rows  Sequelize AmenityBooking instances (or plain objects)
 * @returns {Array<object>} grouped records (plain objects)
 */
function groupAmenityBookings(rows) {
  const out = [];
  const legacyFullDay = new Map();
  const legacySlot = new Map();

  rows.forEach((b) => {
    const row = plain(b);

    /* ── NEW single-row path: row already has from_date/to_date ── */
    if (row.from_date && row.to_date) {
      const dateRange = row.to_date !== row.from_date
        ? `${row.from_date} – ${row.to_date}`
        : row.from_date;
      out.push({
        ...row,
        date: row.date || dateRange,
        date_count: row.date_count || (() => {
          const a = new Date(row.from_date + "T00:00:00");
          const e = new Date(row.to_date   + "T00:00:00");
          return Math.round((e - a) / 86400000) + 1;
        })(),
        slot_count: Array.isArray(row.slots) ? row.slots.length : row.slot_count || 0,
        booking_ids: row.booking_ids || [row.id],
      });
      return;
    }

    /* ── Legacy fallback: multi-row per booking ── */
    if (isFullDay(row)) {
      const key = `${row.amenity_id}|${row.status}|${row.user_id ?? ""}|${row.flat_id ?? ""}`;
      if (!legacyFullDay.has(key)) legacyFullDay.set(key, []);
      legacyFullDay.get(key).push(row);
      return;
    }

    const key = `${row.amenity_id}|${row.status}|${row.date}|${row.user_id ?? ""}|${row.flat_id ?? ""}`;
    if (!legacySlot.has(key)) legacySlot.set(key, []);
    legacySlot.get(key).push(row);
  });

  /* ── Legacy Full-Day groups ── */
  legacyFullDay.forEach((group) => {
    const dates = [...new Set(group.map((e) => e.date))].sort();
    const merged = {
      ...group[0],
      booking_ids: [...new Set(group.map((e) => e.id))],
      from_date: dates[0],
      to_date: dates[dates.length - 1],
      date_count: dates.length,
      date:
        dates[0] === dates[dates.length - 1]
          ? dates[0]
          : `${dates[0]} – ${dates[dates.length - 1]}`,
    };
    out.push(merged);
  });

  /* ── Legacy Time-Slot groups (merge contiguous slots) ── */
  legacySlot.forEach((group) => {
    const entries = group.sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || "") ||
      (a.id - b.id)
    );

    const chains = [];
    entries.forEach((entry) => {
      const idx = chains.findIndex((c) => c[c.length - 1].end_time === entry.start_time);
      if (idx >= 0) chains[idx].push(entry);
      else chains.push([entry]);
    });

    chains.forEach((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      out.push({
        ...first,
        booking_ids: [...new Set(run.map((e) => e.id))],
        start_time: first.start_time,
        end_time: last.end_time,
        slot_count: run.length,
        from_time: toMin(first.start_time),
        to_time: toMin(last.end_time),
      });
    });
  });

  return out;
}

module.exports = { groupAmenityBookings, isFullDay };
