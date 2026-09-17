/**
 * Amenity booking single-row regression tests.
 *
 * Verifies the redesigned booking model:
 *  - one booking = one amenity_bookings row (from_date/to_date, optional slots JSON)
 *  - multi-day FULL_DAY and multi-day SLOT bookings create a single row
 *  - overlapping ranges / duplicate slots are rejected (409)
 *  - my-bookings + admin bookings return the booking as one consolidated record
 *  - availability endpoint supports from_date/to_date ranges
 */
const { request, app, login, unique } = require("./helpers/api");
const { Op } = require("sequelize");
const models = require("../models");
const { AmenityBooking, Amenity } = models;

jest.setTimeout(45000);

function isoFrom(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function futureIso(offsetDays) {
  const d = new Date();
  d.setFullYear(2099, 5, 15 + offsetDays); // fixed far-future base to avoid live data
  return isoFrom(d);
}

let admin, resident;

describe("Amenity Booking — single-row schema", () => {
  let cleanup = [];

  beforeAll(async () => {
    admin = await login("admin");
    resident = await login("resident");
  });

  afterAll(async () => {
    const bookingIds = cleanup.filter((x) => x.type === "booking").map((x) => x.id);
    if (bookingIds.length) {
      await AmenityBooking.destroy({ where: { id: { [Op.in]: bookingIds } } });
    }
    const amenityIds = cleanup.filter((x) => x.type === "amenity").map((x) => x.id);
    if (amenityIds.length) {
      await Amenity.destroy({ where: { id: { [Op.in]: amenityIds } } });
    }
  });

  async function createAmenity(overrides = {}) {
    const payload = {
      name: unique("Amenity"),
      type: "FREE",
      booking_type: "FULL_DAY",
      rate_per_hour: 0,
      capacity: 1,
      requires_approval: false,
      ...overrides,
    };
    const res = await request(app).post("/api/admin/amenities").set(admin.headers).send(payload);
    expect([200, 201]).toContain(res.status);
    const id = res.body?.data?.id || res.body?.id;
    expect(id).toBeDefined();
    cleanup.push({ type: "amenity", id });
    return id;
  }

  test("FULL_DAY multi-day booking creates ONE row with from_date/to_date", async () => {
    const amenityId = await createAmenity({ booking_type: "FULL_DAY" });
    const from = futureIso(0);
    const to   = futureIso(2);

    const res = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: from, to_date: to });
    expect(res.status).toBe(201);
    expect(res.body.requiresPayment).toBe(false);

    const bookingId = res.body?.data?.id || res.body?.bookings?.[0]?.id;
    expect(bookingId).toBeDefined();
    cleanup.push({ type: "booking", id: bookingId });

    const rows = await AmenityBooking.findAll({ where: { id: bookingId } });
    expect(rows.length).toBe(1);
    expect(rows[0].from_date).toBe(from);
    expect(rows[0].to_date).toBe(to);
    expect(rows[0].date).toBe(from);
    expect(rows[0].slots).toBeNull();
    expect(rows[0].start_time).toBe("00:00:00");
    expect(rows[0].end_time).toBe("23:59:59");
    expect(rows[0].status).toBe("APPROVED");
  });

  test("FULL_DAY overlapping range is rejected with 409", async () => {
    const amenityId = await createAmenity({ booking_type: "FULL_DAY" });
    const from = futureIso(4);
    const to   = futureIso(6);
    const first = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: from, to_date: to });
    expect(first.status).toBe(201);
    cleanup.push({ type: "booking", id: first.body?.data?.id });

    const conflict = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: futureIso(5), to_date: futureIso(7) });
    expect(conflict.status).toBe(409);
  });

  test("my-bookings + admin bookings surface the multi-day booking as ONE consolidated record", async () => {
    const amenityId = await createAmenity({ booking_type: "FULL_DAY" });
    const from = futureIso(9);
    const to   = futureIso(11);

    const book = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: from, to_date: to });
    expect(book.status).toBe(201);
    const bookingId = book.body?.data?.id;
    cleanup.push({ type: "booking", id: bookingId });

    const mine = await request(app).get("/api/amenities/my-bookings").set(resident.headers);
    expect(mine.status).toBe(200);
    const mineRow = (mine.body.data || []).find((b) => b.id === bookingId);
    expect(mineRow).toBeDefined();
    expect(mineRow.from_date).toBe(from);
    expect(mineRow.to_date).toBe(to);
    expect(mineRow.date_count).toBe(3);

    const adminRes = await request(app).get("/api/admin/amenities/bookings").set(admin.headers);
    expect(adminRes.status).toBe(200);
    const adminRow = (adminRes.body.data || []).find((b) => b.id === bookingId);
    expect(adminRow).toBeDefined();
    expect(adminRow.from_date).toBe(from);
    expect(adminRow.to_date).toBe(to);
  });

  test("FULL_DAY availability supports from_date/to_date range", async () => {
    const amenityId = await createAmenity({ booking_type: "FULL_DAY" });
    const from = futureIso(13);
    const to   = futureIso(15);

    await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: from, to_date: to })
      .then((r) => cleanup.push({ type: "booking", id: r.body?.data?.id }));

    const avail = await request(app)
      .get(`/api/amenities/${amenityId}/availability`)
      .query({ from_date: from, to_date: to })
      .set(resident.headers);
    expect(avail.status).toBe(200);
    expect(avail.body.bookedDates).toContain(from);
    expect(avail.body.bookedDates).toContain(to);
    expect(avail.body.data.every((d) => d.available === false)).toBe(true);
  });

  test("SLOT multi-day booking creates ONE row with slots JSON; duplicate slot rejected", async () => {
    const amenityId = await createAmenity({
      booking_type: "SLOT",
      type: "FREE",
      opening_time: "09:00:00",
      closing_time: "11:00:00",
      slot_duration: 60,
    });
    const d1 = futureIso(18);
    const d2 = futureIso(19);
    const slots = [
      { date: d1, start_time: "09:00:00" },
      { date: d2, start_time: "10:00:00" },
    ];

    const res = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: d1, to_date: d2, slots });
    expect(res.status).toBe(201);

    const bookingId = res.body?.data?.id;
    expect(bookingId).toBeDefined();
    cleanup.push({ type: "booking", id: bookingId });

    const rows = await AmenityBooking.findAll({ where: { id: bookingId } });
    expect(rows.length).toBe(1);
    expect(rows[0].from_date).toBe(d1);
    expect(rows[0].to_date).toBe(d2);
    expect(rows[0].slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: d1, start_time: "09:00:00" }),
      expect.objectContaining({ date: d2, start_time: "10:00:00" }),
    ]));
    expect(rows[0].start_time).toBe("09:00:00");

    const dup = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId, from_date: d1, to_date: d2, slots: [{ date: d2, start_time: "10:00:00" }] });
    expect(dup.status).toBe(409);

    const avail = await request(app)
      .get(`/api/amenities/${amenityId}/availability`)
      .query({ from_date: d1, to_date: d2 })
      .set(resident.headers);
    expect(avail.status).toBe(200);
    const slot09d1 = avail.body.data.find((s) => s.date === d1 && s.start_time === "09:00:00");
    const slot10d2 = avail.body.data.find((s) => s.date === d2 && s.start_time === "10:00:00");
    expect(slot09d1.available).toBe(false);
    expect(slot10d2.available).toBe(false);
  });
});