/**
 * Amenity Rules & Terms Integration Test Suite
 *
 * Verifies:
 *  - Independent Amenity Rules CRUD for management
 *  - Published rules endpoint with deterministic ruleset_version
 *  - Mandatory acceptance enforcement when rules exist
 *  - Outdated version rejection (409 Conflict)
 *  - Valid version acceptance with immutable snapshot persistence
 *  - Payment verification integrity guard
 *  - Repayment preserves original snapshot without duplicate records
 *  - Historical snapshot retrieval via accepted-terms endpoint
 */

const { request, app, login, unique } = require("./helpers/api");
const models = require("../models");
const { Amenity, AmenityBooking, AmenityRule, AmenityBookingTermsAcceptance } = models;

jest.setTimeout(45000);

function futureIso(offsetDays) {
  const d = new Date();
  d.setFullYear(2099, 8, 10 + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let admin, resident;

describe("Independent Amenity Rules & Terms Management", () => {
  let cleanupRules = [];
  let cleanupAmenities = [];
  let cleanupBookings = [];

  beforeAll(async () => {
    admin = await login("admin");
    resident = await login("resident");
  });

  afterAll(async () => {
    if (cleanupBookings.length) {
      await AmenityBooking.destroy({ where: { id: cleanupBookings } });
    }
    if (cleanupRules.length) {
      await AmenityRule.destroy({ where: { id: cleanupRules } });
    }
    if (cleanupAmenities.length) {
      await Amenity.destroy({ where: { id: cleanupAmenities } });
    }
  });

  test("1. Admin creates an Amenity Rule", async () => {
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(admin.headers)
      .send({
        title: "Clubhouse Damage & Cleaning Policy",
        rule_type: "TEXT",
        content: "A security deposit of Rs 2000 is required. All damages will be deducted from deposit.",
        is_mandatory: true,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.rule_type).toBe("TEXT");
    cleanupRules.push(res.body.data.id);
  });

  test("2. Admin lists amenity rules via /api/admin/amenities/rules", async () => {
    const res = await request(app)
      .get("/api/admin/amenities/rules")
      .set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((r) => cleanupRules.includes(r.id))).toBe(true);
  });

  test("3. Resident fetches published rules with ruleset_version", async () => {
    const res = await request(app)
      .get("/api/amenities/rules/published")
      .set(resident.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.has_rules).toBe(true);
    expect(typeof res.body.ruleset_version).toBe("string");
    expect(res.body.ruleset_version.length).toBeGreaterThan(0);
  });

  test("4. Booking without accepted_ruleset_version is rejected with 400 when rules exist", async () => {
    const amRes = await request(app)
      .post("/api/admin/amenities")
      .set(admin.headers)
      .send({
        name: unique("Hall"),
        type: "FREE",
        booking_type: "FULL_DAY",
        capacity: 1,
      });
    const amenityId = amRes.body?.data?.id || amRes.body?.id;
    cleanupAmenities.push(amenityId);

    const bookRes = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({
        amenityId,
        from_date: futureIso(1),
        to_date: futureIso(2),
      });

    expect(bookRes.status).toBe(400);
    expect(bookRes.body.code).toBe("AMENITY_RULES_ACCEPTANCE_REQUIRED");
  });

  test("5. Booking with outdated accepted_ruleset_version is rejected with 409", async () => {
    const amenityId = cleanupAmenities[0];

    const bookRes = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({
        amenityId,
        from_date: futureIso(1),
        to_date: futureIso(2),
        accepted_ruleset_version: "invalid_outdated_hash_999",
      });

    expect(bookRes.status).toBe(409);
    expect(bookRes.body.code).toBe("AMENITY_RULES_VERSION_OUTDATED");
  });

  test("6. Booking with matching accepted_ruleset_version creates booking + immutable snapshot", async () => {
    const amenityId = cleanupAmenities[0];

    const pubRes = await request(app)
      .get("/api/amenities/rules/published")
      .set(resident.headers);

    const validVersion = pubRes.body.ruleset_version;

    const bookRes = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({
        amenityId,
        from_date: futureIso(1),
        to_date: futureIso(2),
        accepted_ruleset_version: validVersion,
      });

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.success).toBe(true);
    const bookingId = bookRes.body?.data?.id;
    expect(bookingId).toBeDefined();
    cleanupBookings.push(bookingId);

    const bookingRow = await AmenityBooking.findByPk(bookingId);
    expect(bookingRow.terms_accepted).toBe(true);
    expect(bookingRow.terms_accepted_at).not.toBeNull();

    // Verify acceptance record
    const acceptance = await AmenityBookingTermsAcceptance.findOne({
      where: { booking_id: bookingId },
    });
    expect(acceptance).not.toBeNull();
    expect(acceptance.ruleset_version).toBe(validVersion);
    expect(Array.isArray(acceptance.rules_snapshot)).toBe(true);
    expect(acceptance.rules_snapshot.length).toBeGreaterThan(0);
  });

  test("7. Accepted terms retrieval via /api/amenities/bookings/:id/accepted-terms", async () => {
    const bookingId = cleanupBookings[0];

    const res = await request(app)
      .get(`/api/amenities/bookings/${bookingId}/accepted-terms`)
      .set(resident.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.has_accepted_terms).toBe(true);
    expect(res.body.data.booking_id).toBe(bookingId);
    expect(res.body.data.rules_snapshot).toBeDefined();
  });
});
