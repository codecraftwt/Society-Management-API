const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const {
  Amenity,
  AmenityBooking,
  AmenityRule,
  AmenityBookingTermsAcceptance,
} = require("../models");

describe("Mobile App End-to-End Booking & Terms Acceptance Simulation", () => {
  let residentSession;
  let adminSession;
  let testRule;
  let testAmenity;
  let testBookingId;

  beforeAll(async () => {
    residentSession = await login("resident");
    adminSession = await login("admin");
    const societyId = residentSession.user.society_id;

    // 1. Setup society active rule
    testRule = await AmenityRule.create({
      society_id: societyId,
      title: "Mobile Flow Clubhouse & Gym Regulations",
      category: "USAGE_HOURS",
      content: "Clubhouse and gym are open from 6:00 AM to 10:00 PM.",
      formatted_content: "• Proper athletic attire required\n• Wipe down equipment after use",
      is_mandatory: true,
      is_active: true,
      display_order: 1,
      created_by_user_id: adminSession.user.id,
    });

    // 2. Setup active amenity
    testAmenity = await Amenity.create({
      society_id: societyId,
      name: "Mobile E2E Clubhouse",
      type: "FREE",
      booking_type: "FULL_DAY",
      resident_rate_per_hour: 0,
      tenant_rate_per_hour: 0,
      capacity: 50,
      requires_approval: false,
      is_active: true,
    });
  });

  afterAll(async () => {
    if (testBookingId) {
      await AmenityBookingTermsAcceptance.destroy({ where: { booking_id: testBookingId } });
      await AmenityBooking.destroy({ where: { id: testBookingId }, force: true });
    }
    if (testRule) {
      await AmenityRule.destroy({ where: { id: testRule.id }, force: true });
    }
    if (testAmenity) {
      await Amenity.destroy({ where: { id: testAmenity.id }, force: true });
    }
  });

  test("Mobile Step 1: Resident loads amenity details and queries published rules", async () => {
    const res = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.has_rules).toBe(true);
    expect(res.body.ruleset_version).toBeDefined();

    const foundRule = res.body.rules.find((r) => r.id === testRule.id);
    expect(foundRule).toBeDefined();
    expect(foundRule.title).toBe("Mobile Flow Clubhouse & Gym Regulations");
  });

  test("Mobile Step 2: Resident attempts booking without reviewing/accepting rules -> Rejected 400", async () => {
    const res = await request(app)
      .post("/api/amenities/book")
      .set(residentSession.headers)
      .send({
        amenityId: testAmenity.id,
        from_date: "2026-11-28",
        to_date: "2026-11-28",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AMENITY_RULES_ACCEPTANCE_REQUIRED");
  });

  test("Mobile Step 3: Resident opens AmenityRulesModal, checks mandatory acceptance, and requests booking", async () => {
    // Get current version
    const pubRes = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);
    const validVersion = pubRes.body.ruleset_version;

    // Submit booking with valid accepted version
    const res = await request(app)
      .post("/api/amenities/book")
      .set(residentSession.headers)
      .send({
        amenityId: testAmenity.id,
        from_date: "2026-11-28",
        to_date: "2026-11-28",
        accepted_ruleset_version: validVersion,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    testBookingId = res.body.data.id;
    expect(testBookingId).toBeDefined();
  });

  test("Mobile Step 4: Resident / Admin checks booking details with immutable snapshot", async () => {
    const res = await request(app)
      .get(`/api/amenities/bookings/${testBookingId}/accepted-terms`)
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.has_accepted_terms).toBe(true);
    expect(res.body.data.booking_id).toBe(testBookingId);

    const snapshot = res.body.data.acceptance;
    expect(snapshot.user_name_snapshot).toBe(residentSession.user.name || "Resident");
    expect(snapshot.rules_snapshot.length).toBeGreaterThan(0);
  });
});
