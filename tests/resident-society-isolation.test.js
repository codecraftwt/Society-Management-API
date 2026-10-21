const request = require("supertest");
const app = require("../app");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Society = require("../models/Society");
const Block = require("../models/Block");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const Bill = require("../models/Bill");
const VisitorLog = require("../models/VisitorLog");
const VisitorPreApproval = require("../models/VisitorPreApproval");

const tokenFor = (user, societyId) =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: "RESIDENT",
      society_id: societyId,
      activeRole: "RESIDENT",
    },
    process.env.JWT_SECRET || "testsecret",
    { expiresIn: "1h" }
  );

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

/* A resident who belongs to TWO societies must never see data from the
   non-active one when querying resident-scoped panels. */
describe("Resident multi-society data isolation", () => {
  let user;
  let societyA;
  let societyB;
  let flatA;
  let flatB;
  let tokens;
  let titles;
  let visitorNames;
  let passTitles;

  beforeAll(async () => {
    const suffix = Date.now();

    const found = await Society.findAll({ limit: 2, order: [["id", "ASC"]] });
    societyA = found[0] || (await Society.create({ name: `Iso A ${suffix}`, address: "A" }));
    societyB = found[1] || (await Society.create({ name: `Iso B ${suffix}`, address: "B" }));

    let blockA = await Block.findOne({ where: { society_id: societyA.id } });
    if (!blockA) blockA = await Block.create({ name: `IsoBlk A ${suffix}`, society_id: societyA.id });
    let blockB = await Block.findOne({ where: { society_id: societyB.id } });
    if (!blockB) blockB = await Block.create({ name: `Iso B ${suffix}`, society_id: societyB.id });

    user = await User.create({
      name: "Iso Resident",
      email: `iso_${suffix}@multitest.com`,
      password: await bcrypt.hash("Password@123", 10),
      role: "RESIDENT",
      roles: ["RESIDENT"],
      society_id: societyA.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    // Flat A is owned directly by the user (satisfies flatAccessMiddleware).
    flatA = await Flat.create({
      flat_number: `IOS-A-${suffix}`,
      block_id: (await Block.findOne({ where: { society_id: societyA.id } })).id,
      resident_id: user.id,
    });
    flatB = await Flat.create({
      flat_number: `ISO-B-${suffix}`,
      block_id: (await Block.findOne({ where: { society_id: societyB.id } })).id,
    });

    for (const [soc, flat] of [
      [societyA, flatA],
      [societyB, flatB],
    ]) {
      const membership = await UserSociety.create({
        user_id: user.id,
        society_id: soc.id,
        membership_status: "ACTIVE",
        source: "TEST",
      });
      await UserSocietyRole.create({ user_society_id: membership.id, role: "RESIDENT" });
      await FlatMembership.create({
        user_id: user.id,
        flat_id: flat.id,
        society_id: soc.id,
        role: "OWNER",
        is_current: true,
      });
    }

    const guard = await User.findOne({ where: { role: "GUARD" } });
    const guardId = guard ? guard.id : user.id;

    titles = { a: `ISOBIL-A-${suffix}`, b: `ISOBIL-B-${suffix}` };
    await Bill.create({
      title: titles.a,
      flat_id: flatA.id,
      society_id: societyA.id,
      amount: 111,
      billing_month: "2026-01",
      status: "PENDING",
    });
    await Bill.create({
      title: titles.b,
      flat_id: flatB.id,
      society_id: societyB.id,
      amount: 222,
      billing_month: "2026-01",
      status: "PENDING",
    });

    visitorNames = { a: `ISOVIS-A-${suffix}`, b: `ISOVIS-B-${suffix}` };
    await VisitorLog.create({
      visitor_name: visitorNames.a,
      mobile: "9000000011",
      purpose: "GUEST",
      flat_id: flatA.id,
      guard_id: guardId,
      society_id: societyA.id,
    });
    await VisitorLog.create({
      visitor_name: visitorNames.b,
      mobile: "9000000022",
      purpose: "GUEST",
      flat_id: flatB.id,
      guard_id: guardId,
      society_id: societyB.id,
    });

    passTitles = { a: `ISOPASS-A-${suffix}`, b: `ISOPASS-B-${suffix}` };
    const validDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await VisitorPreApproval.create({
      resident_id: user.id,
      society_id: societyA.id,
      flat_id: flatA.id,
      visitor_name: passTitles.a,
      mobile: "9000000033",
      purpose: "Guest",
      otp: "111111",
      valid_date: validDate,
      pass_type: "SINGLE",
      status: "PENDING",
    });
    await VisitorPreApproval.create({
      resident_id: user.id,
      society_id: societyB.id,
      flat_id: flatB.id,
      visitor_name: passTitles.b,
      mobile: "9000000044",
      purpose: "Guest",
      otp: "222222",
      valid_date: validDate,
      pass_type: "SINGLE",
      status: "PENDING",
    });

    tokens = {
      a: tokenFor(user, societyA.id),
      b: tokenFor(user, societyB.id),
    };
  });

  it("GET /api/bills/resident shows only the active society's bills", async () => {
    const resA = await request(app).get("/api/bills/resident").set(authHeader(tokens.a));
    expect(resA.status).toBe(200);
    const listA = resA.body.data.map((b) => b.title);
    expect(listA).toContain(titles.a);
    expect(listA).not.toContain(titles.b);

    const resB = await request(app).get("/api/bills/resident").set(authHeader(tokens.b));
    expect(resB.status).toBe(200);
    const listB = resB.body.data.map((b) => b.title);
    expect(listB).toContain(titles.b);
    expect(listB).not.toContain(titles.a);
  });

  it("GET /api/visitors/resident shows only the active society's visitors", async () => {
    const resA = await request(app).get("/api/visitors/resident").set(authHeader(tokens.a));
    expect(resA.status).toBe(200);
    const namesA = resA.body.visitors.map((v) => v.visitor_name);
    expect(namesA).toContain(visitorNames.a);
    expect(namesA).not.toContain(visitorNames.b);

    const resB = await request(app).get("/api/visitors/resident").set(authHeader(tokens.b));
    expect(resB.status).toBe(200);
    const namesB = resB.body.visitors.map((v) => v.visitor_name);
    expect(namesB).toContain(visitorNames.b);
    expect(namesB).not.toContain(visitorNames.a);
  });

  it("GET /api/preapproval/my shows only the active society's gate passes", async () => {
    const resA = await request(app).get("/api/preapproval/my").set(authHeader(tokens.a));
    expect(resA.status).toBe(200);
    const passesA = resA.body.map((p) => p.visitor_name);
    expect(passesA).toContain(passTitles.a);
    expect(passesA).not.toContain(passTitles.b);

    const resB = await request(app).get("/api/preapproval/my").set(authHeader(tokens.b));
    expect(resB.status).toBe(200);
    const passesB = resB.body.map((p) => p.visitor_name);
    expect(passesB).toContain(passTitles.b);
    expect(passesB).not.toContain(passTitles.a);
  });
});
