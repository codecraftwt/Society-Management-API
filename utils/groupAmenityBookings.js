/**
 * Group amenity booking rows by booking.
 *
 * A single multi-day Full-Day booking (e.g. 28–31) is stored as one DB row
 * per day. A single time-slot booking that spans several consecutive hourly
 * slots (e.g. a 7–10 window = rows 07–08, 08–09, 09–10) is stored as one row
 * per slot. Both should surface to the user as ONE record.
 *
 *  • Full-Day rows  → grouped by amenity_id + status, merged into a date range.
 *  • Slot rows      → grouped by amenity_id + status + date + user + flat, then
 *                     contiguous slots (start_time == previous end_time) are
 *                     merged into a single time range.
 */

const isFullDay = (b) => !b.start_time || b.start_time === "00:00:00";

const toMin = (t) => {
  if (!t) return 0;
  const p = String(t).split(":");
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
};

const toHM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;

const plain = (b) => (b && b.get ? b.get({ plain: true }) : { ...b });

/**
 * @param {Array<object>} rows  Sequelize AmenityBooking instances (or plain objects)
 * @returns {Array<object>} grouped records (plain objects)
 */
function groupAmenityBookings(rows) {
  const out = [];
  const fullDayGroups = new Map();
  const slotGroups = new Map();

  rows.forEach((b) => {
    if (isFullDay(b)) {
      const key = `${b.amenity_id}|${b.status}|${b.user_id ?? ""}|${b.flat_id ?? ""}`;
      if (!fullDayGroups.has(key)) fullDayGroups.set(key, []);
      fullDayGroups.get(key).push(b);
      return;
    }

    const key = `${b.amenity_id}|${b.status}|${b.date}|${b.user_id ?? ""}|${b.flat_id ?? ""}`;
    if (!slotGroups.has(key)) slotGroups.set(key, []);
    slotGroups.get(key).push(b);
  });

  /* ── Full-Day groups (existing behaviour) ── */
  fullDayGroups.forEach((group) => {
    const entries = group.map(plain);
    const dates = [...new Set(entries.map((e) => e.date))].sort();
    const merged = {
      ...entries[0],
      booking_ids: [...new Set(entries.map((e) => e.id))],
      dates,
      from_date: dates[0],
      to_date: dates[dates.length - 1],
      date_count: dates.length,
      date:
        dates[0] === dates[dates.length - 1]
          ? dates[0]
          : `${dates[0]} – ${dates[dates.length - 1]}`,
    };
    delete merged.dates;
    out.push(merged);
  });

  /* ── Time-Slot groups (merge contiguous slots) ── */
  slotGroups.forEach((group) => {
    const entries = group.map(plain).sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || "") ||
      (a.id - b.id)
    );

    /* Build maximal contiguous chains by extending any open chain whose last
       end_time matches the current slot's start_time. This stays correct even
       when a resident has two overlapping (duplicate) bookings whose slots are
       interleaved — each booking resolves to its own clean 05:00–08:00 block
       instead of fragmenting into 05–06 / 05–07 / 06–08 / 07–08. */
    const chains = [];
    entries.forEach((entry) => {
      const idx = chains.findIndex((c) => c[c.length - 1].end_time === entry.start_time);
      if (idx >= 0) chains[idx].push(entry);
      else chains.push([entry]);
    });

    chains.forEach((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      const merged = {
        ...first,
        booking_ids: [...new Set(run.map((e) => e.id))],
        start_time: first.start_time,
        end_time: last.end_time,
        slot_count: run.length,
        from_time: toMin(first.start_time),
        to_time: toMin(last.end_time),
      };
      out.push(merged);
    });
  });

  return out;
}

module.exports = { groupAmenityBookings, isFullDay };
