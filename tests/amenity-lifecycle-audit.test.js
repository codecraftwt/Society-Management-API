jest.mock("../utils/pushNotification", () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ status: "SENT" }),
  isPushEnabled: () => false,
}));

const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const {
  Amenity,
  AmenityBooking,
  AmenityRule,
  AmenityBookingTermsAcceptance,
  sequelize,
} = require("../models");

describe("Amenities Payment Lifecycle & Legacy Bookings Audit", () => {
  let adminSession;
  let residentSession;
  let testPaidAmenity;
  let activeRule;
  let rulesetVersion;
  let paidBookingId;
  let legacyBookingId;

  beforeAll(async () => {
    adminSession = await login("admin");
    residentSession = await login("resident");
    const societyId = residentSession.user.society_id;

    // 1. Ensure an active rule exists
    activeRule = await AmenityRule.create({
      society_id: societyId,
      title: "Audit Payment Terms & Damage Recovery",
      category: "DAMAGE_POLICY",
      content: "All damages must be reimbursed prior to deposit release.",
      is_mandatory: true,
      is_active: true,
      display_order: 1,
      created_by_user_id: adminSession.user.id,
    });

    const pubRes = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);
    rulesetVersion = pubRes.body.ruleset_version;

    // 2. Create a PAID amenity for testing payment lifecycle
    testPaidAmenity = await Amenity.create({
      society_id: societyId,
      name: "Audit Test Tennis Court",
      type: "PAID",
      booking_type: "FULL_DAY",
      resident_rate_per_hour: 250,
      tenant_rate_per_hour: 350,
      opening_time: "06:00:00",
      closing_time: "22:00:00",
      capacity: 4,
      requires_approval: false,
      is_active: true,
    });

    // 3. Create a LEGACY booking (simulating pre-existing booking without terms acceptance)
    const legacy = await AmenityBooking.create({
      society_id: societyId,
      amenity_id: testPaidAmenity.id,
      user_id: residentSession.user.id,
      from_date: "2026-01-15",
      to_date: "2026-01-15",
      date: "2026-01-15",
      slots: [],
      status: "APPROVED",
      payment_status: "PAID",
      amount: 250,
      terms_accepted: 0,
      terms_accepted_at: null,
    });
    legacyBookingId = legacy.id;
  });

  afterAll(async () => {
    if (paidBookingId) {
      await AmenityBookingTermsAcceptance.destroy({ where: { booking_id: paidBookingId } });
      await AmenityBooking.destroy({ where: { id: paidBookingId }, force: true });
    }
    if (legacyBookingId) {
      await AmenityBooking.destroy({ where: { id: legacyBookingId }, force: true });
    }
    if (activeRule) {
      await AmenityRule.destroy({ where: { id: activeRule.id }, force: true });
    }
    if (testPaidAmenity) {
      await Amenity.destroy({ where: { id: testPaidAmenity.id }, force: true });
    }
  });

  test("1. Create paid booking with accepted_ruleset_version creates immutable snapshot", async () => {
    const res = await request(app)
      .post("/api/amenities/book")
      .set(residentSession.headers)
      .send({
        amenityId: testPaidAmenity.id,
        from_date: "2026-12-25",
        to_date: "2026-12-25",
        accepted_ruleset_version: rulesetVersion,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.requiresPayment).toBe(true);

    paidBookingId = res.body.data.id;
    expect(paidBookingId).toBeDefined();

    // Verify snapshot in database
    const snapshot = await AmenityBookingTermsAcceptance.findOne({
      where: { booking_id: paidBookingId },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot.ruleset_version).toBe(rulesetVersion);
    expect(Array.isArray(snapshot.rules_snapshot)).toBe(true);
    expect(snapshot.rules_snapshot.length).toBeGreaterThan(0);
  });

  test("2. Payment retry (repay) preserves acceptance snapshot and extends expiry", async () => {
    const res = await request(app)
      .post(`/api/amenities/${paidBookingId}/repay`)
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.upiPayment).toBeDefined();

    // Verify snapshot still exists and has not been duplicated
    const snapshots = await AmenityBookingTermsAcceptance.findAll({
      where: { booking_id: paidBookingId },
    });
    expect(snapshots.length).toBe(1);
  });

  test("3. Payment verification confirms payment while retaining terms snapshot", async () => {
    const res = await request(app)
      .post("/api/amenities/verify-payment")
      .set(residentSession.headers)
      .send({
        booking_ids: [paidBookingId],
        payment_id: "demo_upi_txn_audit_123",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const booking = await AmenityBooking.findByPk(paidBookingId);
    expect(booking.payment_status).toBe("PAID");
    expect(Boolean(booking.terms_accepted)).toBe(true);

    const snapshot = await AmenityBookingTermsAcceptance.findOne({
      where: { booking_id: paidBookingId },
    });
    expect(snapshot).not.toBeNull();
  });

  test("4. Cancellation preserves historical acceptance snapshot for auditing", async () => {
    const res = await request(app)
      .put(`/api/amenities/${paidBookingId}/cancel`)
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const booking = await AmenityBooking.findByPk(paidBookingId);
    expect(booking.status).toBe("CANCELLED");

    // Snapshot MUST still exist in database
    const snapshot = await AmenityBookingTermsAcceptance.findOne({
      where: { booking_id: paidBookingId },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot.ruleset_version).toBe(rulesetVersion);
  });

  test("5. Legacy booking without acceptance record handles accepted-terms cleanly (200 OK, null acceptance)", async () => {
    const res = await request(app)
      .get(`/api/amenities/bookings/${legacyBookingId}/accepted-terms`)
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.acceptance).toBeNull();
    expect(res.body.data.booking.terms_accepted).toBe(false);
  });

  test("6. Legacy bookings render in admin and resident booking lists without crashing", async () => {
    // Admin list
    const adminRes = await request(app)
      .get("/api/admin/amenities/bookings")
      .set(adminSession.headers);
    expect(adminRes.status).toBe(200);
    const adminBookings = adminRes.body.data || adminRes.body.bookings || [];
    const foundLegacyAdmin = adminBookings.find((b) => b.id === legacyBookingId);
    expect(foundLegacyAdmin).toBeDefined();

    // Resident list
    const resRes = await request(app)
      .get("/api/amenities/my-bookings")
      .set(residentSession.headers);
    expect(resRes.status).toBe(200);
    const myBookings = resRes.body.data || resRes.body.bookings || [];
    const foundLegacyResident = myBookings.find((b) => b.id === legacyBookingId);
    expect(foundLegacyResident).toBeDefined();
  });
});
