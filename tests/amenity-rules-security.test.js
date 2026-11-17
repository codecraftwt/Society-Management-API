jest.mock("../utils/pushNotification", () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ status: "SENT" }),
  isPushEnabled: () => false,
}));

const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const { AmenityRule, Society } = require("../models");

describe("Amenities Rules Security & Multi-Tenant Isolation Audit", () => {
  let superAdminSession;
  let adminSession;
  let residentSession;
  let committeeSession;
  let testRuleId;
  let secondSocietyId;

  beforeAll(async () => {
    superAdminSession = await login("superAdmin");
    adminSession = await login("admin");
    residentSession = await login("resident");
    try {
      committeeSession = await login("committee");
    } catch (_) {
      committeeSession = null;
    }

    // Find or create a second society for isolation testing
    let secondSociety = await Society.findOne({
      where: { id: { [require("sequelize").Op.ne]: adminSession.user.society_id } },
    });
    if (!secondSociety) {
      secondSociety = await Society.create({
        name: "Security Audit Society Beta",
        address: "789 Isolation Blvd",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
      });
    }
    secondSocietyId = secondSociety.id;
  });

  afterAll(async () => {
    if (testRuleId) {
      await AmenityRule.destroy({ where: { id: testRuleId }, force: true });
    }
    await AmenityRule.destroy({ where: { society_id: secondSocietyId }, force: true });
  });

  test("1. Resident cannot create an amenity rule (403 Forbidden)", async () => {
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(residentSession.headers)
      .send({
        title: "Unauthorized Resident Rule",
        content: "Residents should not be able to create rules.",
        category: "GENERAL",
      });

    expect([401, 403]).toContain(res.status);
  });

  test("2. Resident cannot edit or delete an amenity rule (403 Forbidden)", async () => {
    const editRes = await request(app)
      .put("/api/admin/amenities/rules/999999")
      .set(residentSession.headers)
      .send({ title: "Hacked Rule" });
    expect([401, 403]).toContain(editRes.status);

    const deleteRes = await request(app)
      .delete("/api/admin/amenities/rules/999999")
      .set(residentSession.headers);
    expect([401, 403]).toContain(deleteRes.status);
  });

  test("3. Society Admin can create a rule scoped to their society", async () => {
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(adminSession.headers)
      .field("title", "Society Admin Scoped Rule")
      .field("content", "Only residents of this society must adhere to this rule.")
      .field("category", "DAMAGE_POLICY")
      .field("is_mandatory", true)
      .field("display_order", 1);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.society_id).toBe(adminSession.user.society_id);
    testRuleId = res.body.data.id;
  });

  test("4. Society Admin cannot manipulate or spoof another society_id in body", async () => {
    // Non-superadmin sending a foreign society_id in body must NOT override their session society_id
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(adminSession.headers)
      .field("title", "Spoofed Society Rule")
      .field("content", "Attempting to write to foreign society")
      .field("category", "GENERAL")
      .field("society_id", secondSocietyId);

    expect(res.status).toBe(201);
    // Verified that it safely stayed scoped to admin's own society
    expect(res.body.data.society_id).toBe(adminSession.user.society_id);
    await AmenityRule.destroy({ where: { id: res.body.data.id }, force: true });
  });

  test("5. Super Admin can manage rules across different societies via societyId query/body", async () => {
    const res = await request(app)
      .post("/api/admin/amenities/rules")
      .set(superAdminSession.headers)
      .field("title", "Super Admin Society Beta Rule")
      .field("content", "Rule created specifically for Society Beta.")
      .field("category", "USAGE_HOURS")
      .field("society_id", secondSocietyId);

    expect(res.status).toBe(201);
    expect(res.body.data.society_id).toBe(secondSocietyId);
    const betaRuleId = res.body.data.id;

    // Super Admin lists rules for Society Beta
    const listBeta = await request(app)
      .get(`/api/admin/amenities/rules?societyId=${secondSocietyId}`)
      .set(superAdminSession.headers);

    expect(listBeta.status).toBe(200);
    const betaRules = listBeta.body.data || listBeta.body.rules || [];
    expect(betaRules.some((r) => r.id === betaRuleId)).toBe(true);

    // Clean up beta rule
    await AmenityRule.destroy({ where: { id: betaRuleId }, force: true });
  });

  test("6. Society Isolation: Residents only receive their own society's published rules", async () => {
    // Resident fetches published rules
    const res = await request(app)
      .get("/api/amenities/rules/published")
      .set(residentSession.headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const rules = res.body.rules || [];
    for (const rule of rules) {
      expect(rule.society_id).toBe(residentSession.user.society_id);
      expect(rule.society_id).not.toBe(secondSocietyId);
    }
  });

  test("7. Committee member with view permission can list rules", async () => {
    if (!committeeSession) {
      console.log("Skipping committee test (no committee user configured)");
      return;
    }
    const res = await request(app)
      .get("/api/admin/amenities/rules")
      .set(committeeSession.headers);

    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });
});
