const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const {
  Amenity,
  AmenityBooking,
  AmenityRule,
  AmenityRuleAttachment,
  AmenityBookingTermsAcceptance,
} = require("../models");
const path = require("path");

describe("Web Dashboard Amenities Rules & resident acceptance flow", () => {
  let adminSession;
  let residentSession;
  let ruleId;
  let testAmenity;
  let bookingId;

  beforeAll(async () => {
    adminSession = await login("admin");
    residentSession = await login("resident");
    const societyId = adminSession.user.society_id;

    testAmenity = await Amenity.create({
      society_id: societyId,
      name: "Web Flow Swimming Pool",
      type: "FREE",
      booking_type: "FULL_DAY",
      resident_rate_per_hour: 0,
      tenant_rate_per_hour: 0,
      capacity: 20,
      requires_approval: false,
      is_active: true,
    });
  });

  afterAll(async () => {
    if (bookingId) {
      await AmenityBookingTermsAcceptance.destroy({ where: { booking_id: bookingId } });
      await AmenityBooking.destroy({ where: { id: bookingId }, force: true });
    }
    if (ruleId) {
      await AmenityRuleAttachment.destroy({ where: { rule_id: ruleId } });
      await AmenityRule.destroy({ where: { id: ruleId }, force: true });
    }
    if (testAmenity) {
      await Amenity.destroy({ where: { id: testAmenity.id }, force: true });
    }
  });

  test("Web Admin Action 1: Create rule with bullet guidelines and attachments", async () => {
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(adminSession.headers)
      .field("title", "Pool Hygiene & Safety Policy")
      .field("category", "CLEANING")
      .field("content", "All swimmers must shower before entering the pool.")
      .field("formatted_content", "• Proper nylon swimwear required\n• No glass bottles near pool deck")
      .field("is_mandatory", true)
      .field("display_order", 2);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    ruleId = res.body.data.id;
    expect(ruleId).toBeDefined();
    expect(res.body.data.category).toBe("CLEANING");
  });

  test("Web Admin Action 2: Edit rule details, category, and update content", async () => {
    const res = await request(app)
      .put(`/api/admin/amenities/rules/${ruleId}`)
      .set(adminSession.headers)
      .field("title", "Updated Pool & Deck Hygiene Policy")
      .field("content", "All swimmers must shower and wear swimming caps.")
      .field("category", "CLEANING")
      .field("is_mandatory", true)
      .field("display_order", 1);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Updated Pool & Deck Hygiene Policy");
    expect(res.body.data.display_order).toBe(1);
  });

  test("Web Resident Action 3: Review published rules in AmenityTermsModal and submit booking", async () => {
    // 1. Fetch published rules
    const pubRes = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);

    expect(pubRes.status).toBe(200);
    expect(pubRes.body.has_rules).toBe(true);
    const rulesetVersion = pubRes.body.ruleset_version;
    expect(rulesetVersion).toBeDefined();

    // 2. Submit booking request with accepted ruleset version
    const bookRes = await request(app)
      .post("/api/amenities/book")
      .set(residentSession.headers)
      .send({
        amenityId: testAmenity.id,
        from_date: "2026-12-10",
        to_date: "2026-12-10",
        accepted_ruleset_version: rulesetVersion,
      });

    expect([200, 201]).toContain(bookRes.status);
    expect(bookRes.body.success).toBe(true);
    bookingId = bookRes.body.data.id;
  });

  test("Web Resident / Admin Action 4: Open AcceptedTermsModal and verify historical snapshot", async () => {
    const res = await request(app)
      .get(`/api/amenities/bookings/${bookingId}/accepted-terms`)
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.has_accepted_terms).toBe(true);
    expect(res.body.data.booking_id).toBe(bookingId);
    expect(res.body.data.acceptance).toBeDefined();

    const snapshot = res.body.data.acceptance;
    const poolRuleInSnapshot = snapshot.rules_snapshot.find((r) => r.id === ruleId);
    expect(poolRuleInSnapshot).toBeDefined();
    expect(poolRuleInSnapshot.title).toBe("Updated Pool & Deck Hygiene Policy");
  });

  test("Web Admin Action 5: Delete rule (soft delete) while verifying historical booking audit snapshot remains intact", async () => {
    // Admin deletes the rule
    const delRes = await request(app)
      .delete(`/api/admin/amenities/rules/${ruleId}`)
      .set(adminSession.headers);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Rule is no longer in published rules
    const pubRes = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);

    const deletedRuleInPublished = (pubRes.body.rules || []).find((r) => r.id === ruleId);
    expect(deletedRuleInPublished).toBeUndefined();

    // BUT the past booking's accepted terms STILL contains the rule snapshot!
    const termsRes = await request(app)
      .get(`/api/amenities/bookings/${bookingId}/accepted-terms`)
      .set(residentSession.headers);

    expect(termsRes.status).toBe(200);
    expect(termsRes.body.has_accepted_terms).toBe(true);
    const poolRuleStillInSnapshot = termsRes.body.data.acceptance.rules_snapshot.find((r) => r.id === ruleId);
    expect(poolRuleStillInSnapshot).toBeDefined();
    expect(poolRuleStillInSnapshot.title).toBe("Updated Pool & Deck Hygiene Policy");
  });
});
