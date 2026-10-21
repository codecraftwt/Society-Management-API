const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const Society = require("../models/Society");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const Block = require("../models/Block");
const bcrypt = require("bcryptjs");

describe("Resident Multi-Society Management API & Security Tests", () => {
  let superAdminHeaders;
  let societyAId;
  let societyBId;
  let flatAId;
  let flatBId;

  const testEmail = `rahul_${Date.now()}@multitest.com`;
  const testPassword = "Password@123";

  beforeAll(async () => {
    const superAdminSession = await login("superAdmin");
    superAdminHeaders = superAdminSession.headers;

    const societies = await Society.findAll({ limit: 2 });
    let socA = societies[0];
    let socB = societies[1];
    if (!socA) {
      socA = await Society.create({ name: "Society Alpha", address: "Alpha Street" });
    }
    if (!socB) {
      socB = await Society.create({ name: "Society Beta", address: "Beta Street" });
    }
    societyAId = socA.id;
    societyBId = socB.id;

    const Block = require("../models/Block");
    let blockA = await Block.findOne({ where: { society_id: societyAId } });
    if (!blockA) blockA = await Block.create({ name: "Block A", society_id: societyAId });
    let blockB = await Block.findOne({ where: { society_id: societyBId } });
    if (!blockB) blockB = await Block.create({ name: "Block B", society_id: societyBId });

    let flatA = await Flat.findOne({ where: { block_id: blockA.id } });
    if (!flatA) flatA = await Flat.create({ flat_number: "A-101", block_id: blockA.id });
    flatAId = flatA.id;

    let flatB = await Flat.findOne({ where: { block_id: blockB.id } });
    if (!flatB) flatB = await Flat.create({ flat_number: "B-201", block_id: blockB.id });
    flatBId = flatB.id;
  });

  describe("Phase 1 & 2: Resident Registration, Email Verification & Account Reuse", () => {
    it("returns exists: false for a non-existent email", async () => {
      const res = await request(app)
        .get("/api/users/resident/check-email")
        .query({ email: testEmail, society_id: societyAId })
        .set(superAdminHeaders);

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(false);
    });

    it("registers resident in Society A, then check-email returns alreadyMember in Society A and exists_other in Society B", async () => {
      const createRes = await request(app)
        .post("/api/users/resident")
        .set({ ...superAdminHeaders, "x-society-id": String(societyAId) })
        .send({
          name: "Rahul MultiResident",
          email: testEmail,
          password: testPassword,
          phone: "9876543210",
          society_id: societyAId,
          flat_id: flatAId,
          occupant_count: 3,
          vehicle_count: 1,
          emergency_contact: { name: "Anjali Sharma", phone: "9876543219" },
          flat_assignments: [{ flat_id: flatAId }],
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.reused).toBe(false);

      // Verify user created with correct details
      const user = await User.findOne({ where: { email: testEmail } });
      expect(user).toBeTruthy();
      expect(user.occupant_count).toBe(3);

      // Check in Society A -> alreadyMember
      const checkA = await request(app)
        .get("/api/users/resident/check-email")
        .query({ email: testEmail, society_id: societyAId })
        .set(superAdminHeaders);

      expect(checkA.status).toBe(200);
      expect(checkA.body.exists).toBe(true);
      expect(checkA.body.alreadyMember).toBe(true);

      // Check in Society B -> exists, alreadyMember: false
      const checkB = await request(app)
        .get("/api/users/resident/check-email")
        .query({ email: testEmail, society_id: societyBId })
        .set(superAdminHeaders);

      expect(checkB.status).toBe(200);
      expect(checkB.body.exists).toBe(true);
      expect(checkB.body.alreadyMember).toBe(false);
      expect(checkB.body.user).toHaveProperty("name", "Rahul MultiResident");
    });

    it("prevents creating duplicate resident in Society A with same email", async () => {
      const dupRes = await request(app)
        .post("/api/users/resident")
        .set({ ...superAdminHeaders, "x-society-id": String(societyAId) })
        .send({
          name: "Rahul Duplicate",
          email: testEmail,
          flat_id: flatAId,
          flat_assignments: [{ flat_id: flatAId }],
        });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.message).toMatch(/already registered in the selected society/i);
    });

    it("allows adding the existing resident to Society B without duplicate email error", async () => {
      const reuseRes = await request(app)
        .post("/api/users/resident")
        .set({ ...superAdminHeaders, "x-society-id": String(societyBId) })
        .send({
          name: "Rahul MultiResident",
          email: testEmail,
          useExistingAccount: true,
          society_id: societyBId,
          flat_id: flatBId,
          flat_assignments: [{ flat_id: flatBId }],
        });

      expect(reuseRes.status).toBe(201);
      expect(reuseRes.body.reused).toBe(true);

      // Verify user has memberships in both societies
      const user = await User.findOne({ where: { email: testEmail } });
      expect(user).toBeTruthy();

      const memberships = await UserSociety.findAll({ where: { user_id: user.id } });
      const socIds = memberships.map((m) => m.society_id);
      expect(socIds).toContain(societyAId);
      expect(socIds).toContain(societyBId);
    });
  });

  describe("Phase 3: Society Switching and Role Isolation", () => {
    let residentToken;
    let rahulUser;

    beforeAll(async () => {
      rahulUser = await User.findOne({ where: { email: testEmail } });

      // Promote to COMMITTEE_MEMBER in Society A only
      const memA = await UserSociety.findOne({ where: { user_id: rahulUser.id, society_id: societyAId } });
      if (memA) {
        await UserSocietyRole.findOrCreate({
          where: { user_society_id: memA.id, role: "COMMITTEE_MEMBER" },
          defaults: { user_society_id: memA.id, role: "COMMITTEE_MEMBER" },
        });
      }

      // Generate token for Rahul in Society A
      const jwt = require("jsonwebtoken");
      residentToken = jwt.sign(
        {
          id: rahulUser.id,
          email: rahulUser.email,
          role: "RESIDENT",
          society_id: societyAId,
          activeSocietyId: societyAId,
        },
        process.env.JWT_SECRET || "testsecret",
        { expiresIn: "1h" }
      );
    });

    it("GET /api/auth/societies returns both Society A and Society B with their specific roles", async () => {
      const res = await request(app)
        .get("/api/auth/societies")
        .set({ Authorization: `Bearer ${residentToken}` });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.societies)).toBe(true);

      const socA = res.body.societies.find((s) => s.id === societyAId);
      const socB = res.body.societies.find((s) => s.id === societyBId);

      expect(socA).toBeTruthy();
      expect(socB).toBeTruthy();

      // Society A has COMMITTEE_MEMBER, Society B only has RESIDENT
      expect(socA.roles).toContain("COMMITTEE_MEMBER");
      expect(socB.roles).not.toContain("COMMITTEE_MEMBER");
      expect(socB.roles).toContain("RESIDENT");
    });

    it("switches to Society B without logout and recomputes roles for Society B", async () => {
      const switchRes = await request(app)
        .post("/api/auth/switch-society")
        .set({ Authorization: `Bearer ${residentToken}` })
        .send({ society_id: societyBId });

      expect(switchRes.status).toBe(200);
      expect(switchRes.body.token).toBeTruthy();
      expect(switchRes.body.society_id).toBe(societyBId);
      expect(switchRes.body.roles).toContain("RESIDENT");
      expect(switchRes.body.roles).not.toContain("COMMITTEE_MEMBER");
    });

    it("rejects switching to an unauthorized society", async () => {
      const unauthorizedRes = await request(app)
        .post("/api/auth/switch-society")
        .set({ Authorization: `Bearer ${residentToken}` })
        .send({ society_id: 99999 });

      expect([403, 404]).toContain(unauthorizedRes.status);
    });

    it("promotes resident to committee member in a specific society", async () => {
      const superAdminSession = await login("superAdmin");
      const promoteRes = await request(app)
        .post("/api/users/committee/promote")
        .set(superAdminSession.headers)
        .send({ userId: rahulUser.id, societyId: societyBId });

      expect(promoteRes.status).toBe(200);

      // Verify society B now has COMMITTEE_MEMBER and activeRole defaults to RESIDENT
      const switchRes = await request(app)
        .post("/api/auth/switch-society")
        .set({ Authorization: `Bearer ${residentToken}` })
        .send({ society_id: societyBId });

      expect(switchRes.status).toBe(200);
      expect(switchRes.body.roles).toContain("COMMITTEE_MEMBER");
      expect(switchRes.body.roles).toContain("RESIDENT");
      expect(switchRes.body.user.activeRole).toBe("RESIDENT");
      expect(switchRes.body.availablePanels).toContain("COMMITTEE_MEMBER");
      expect(switchRes.body.availablePanels).toContain("RESIDENT");

      // Verify resident can switch to COMMITTEE_MEMBER role in Society B
      const switchRoleRes = await request(app)
        .post("/api/auth/switch-role")
        .set({ Authorization: `Bearer ${switchRes.body.token}` })
        .send({ role: "COMMITTEE_MEMBER" });

      expect(switchRoleRes.status).toBe(200);
      expect(switchRoleRes.body.user.activeRole).toBe("COMMITTEE_MEMBER");

      // Verify GET /api/users/me returns Society B details matching active society
      const meRes = await request(app)
        .get("/api/users/me")
        .set({ Authorization: `Bearer ${switchRes.body.token}` });

      expect(meRes.status).toBe(200);
      expect(meRes.body.Society.id).toBe(societyBId);
    });

    it("scopes GET /api/users/get-flat to the active society", async () => {
      // Create a flat in society A and society B
      const blockA = await Block.create({ name: "Wing A", society_id: societyAId });
      const flatA = await Flat.create({ flat_number: "A-901", block_id: blockA.id });
      await FlatMembership.create({ user_id: rahulUser.id, flat_id: flatA.id, role: "OWNER", is_current: true });

      const blockB = await Block.create({ name: "Wing B", society_id: societyBId });
      const flatB = await Flat.create({ flat_number: "B-902", block_id: blockB.id });
      await FlatMembership.create({ user_id: rahulUser.id, flat_id: flatB.id, role: "OWNER", is_current: true });

      // In Society A:
      const switchA = await request(app)
        .post("/api/auth/switch-society")
        .set({ Authorization: `Bearer ${residentToken}` })
        .send({ society_id: societyAId });
      const resA = await request(app)
        .get("/api/users/get-flat")
        .set({ Authorization: `Bearer ${switchA.body.token}` });

      expect(resA.status).toBe(200);
      expect(resA.body.some((f) => f.flat_number === "A-901")).toBe(true);
      expect(resA.body.some((f) => f.flat_number === "B-902")).toBe(false);

      // In Society B:
      const switchB = await request(app)
        .post("/api/auth/switch-society")
        .set({ Authorization: `Bearer ${residentToken}` })
        .send({ society_id: societyBId });
      const resB = await request(app)
        .get("/api/users/get-flat")
        .set({ Authorization: `Bearer ${switchB.body.token}` });

      expect(resB.status).toBe(200);
      expect(resB.body.some((f) => f.flat_number === "B-902")).toBe(true);
      expect(resB.body.some((f) => f.flat_number === "A-901")).toBe(false);
    });
  });

  describe("Phase 3: Document Privacy & Access Control", () => {
    it("prevents unauthorized user from accessing another user's documents", async () => {
      const strangerSession = await login("resident");
      const res = await request(app)
        .get("/api/user-documents/my")
        .set(strangerSession.headers);

      // Only returns stranger's own doc or null, never other users'
      if (res.body) {
        expect(res.body.user_id).toBe(strangerSession.user.id);
      }
    });

    it("allows admin to fetch user documents by userId and prevents unauthorized user", async () => {
      const adminSession = await login("admin");
      const strangerSession = await login("resident");

      // Admin can fetch
      const adminRes = await request(app)
        .get(`/api/user-documents/user/${adminSession.user.id}`)
        .set(adminSession.headers);
      expect([200, 404]).toContain(adminRes.status);

      // Stranger resident cannot fetch admin's docs
      const unauthorizedRes = await request(app)
        .get(`/api/user-documents/user/${adminSession.user.id}`)
        .set(strangerSession.headers);
      expect([403]).toContain(unauthorizedRes.status);
    });
  });

  describe("Phase 3: Public / Mobile Self-Registration with Household Details", () => {
    it("creates a new registration with occupant and vehicle counts", async () => {
      const publicEmail = `public_${Date.now()}@example.com`;
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Mobile Applicant",
          email: publicEmail,
          phone: "9988776655",
          password: "Password@123",
          society_id: societyAId,
          flat_id: flatAId,
          occupant_count: 4,
          vehicle_count: 2,
          emergency_contact: { name: "Guardian", phone: "9988776600" },
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/Pending Approval/i);

      // Verify UserSociety was created with PENDING status
      const user = await User.findOne({ where: { email: publicEmail } });
      expect(user).toBeTruthy();
      const mem = await UserSociety.findOne({ where: { user_id: user.id, society_id: societyAId } });
      expect(mem).toBeTruthy();
      expect(mem.membership_status).toBe("PENDING");
      expect(mem.occupant_count).toBe(4);
      expect(mem.vehicle_count).toBe(2);
    });

    it("public GET /api/auth/check-email returns existing profile and documents info for registered user", async () => {
      const res = await request(app)
        .get("/api/auth/check-email")
        .query({ email: testEmail, society_id: societyBId });

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.user).toBeTruthy();
      expect(res.body.user.name).toBe("Rahul MultiResident");
      expect(res.body.user.occupant_count).toBe(3);
    });

    it("allows public registration to link an existing user to another society with existing password", async () => {
      const linkEmail = `existing_link_${Date.now()}@example.com`;
      const linkPassword = "Password@123";

      // 1. First register in Society A
      const regA = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Link Resident",
          email: linkEmail,
          phone: "9876543299",
          password: linkPassword,
          society_id: societyAId,
          flat_id: flatAId,
          occupant_count: 2,
          vehicle_count: 1,
          emergency_contact: { name: "Mom", phone: "9876543200" },
        });
      expect(regA.status).toBe(201);

      // 2. Register same email in Society B with existing password
      const regB = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Link Resident",
          email: linkEmail,
          phone: "9876543299",
          password: linkPassword,
          society_id: societyBId,
          flat_id: flatBId,
        });

      expect(regB.status).toBe(201);
      expect(regB.body.reused).toBe(true);

      // Verify User record is unique and has memberships in both societies
      const user = await User.findOne({ where: { email: linkEmail } });
      const memberships = await UserSociety.findAll({ where: { user_id: user.id } });
      expect(memberships.length).toBe(2);
    });
  });

  describe("Phase 5: Assign Flat from Different Society via /api/flats/assign/:flatId", () => {
    it("adds new UserSociety membership when assigned flat from different society without overriding primary society", async () => {
      // 1. Create a resident belonging strictly to Society A
      const assignEmail = `assign_diff_${Date.now()}@example.com`;
      const residentSocA = await User.create({
        name: "Assign Cross Society User",
        email: assignEmail,
        password: await bcrypt.hash("Password@123", 8),
        role: "RESIDENT",
        roles: ["RESIDENT"],
        society_id: societyAId,
        approval_status: "APPROVED",
        status: "ACTIVE",
      });

      // Create an unassigned flat in Society B
      const Block = require("../models/Block");
      let blockB = await Block.findOne({ where: { society_id: societyBId } });
      const crossFlatB = await Flat.create({
        flat_number: `X-${Date.now().toString().slice(-4)}`,
        block_id: blockB.id,
      });

      // 2. Assign flat from Society B to residentSocA via PUT /api/flats/assign/:flatId
      const assignRes = await request(app)
        .put(`/api/flats/assign/${crossFlatB.id}`)
        .set({ ...superAdminHeaders, "x-society-id": String(societyBId) })
        .send({
          resident_id: residentSocA.id,
          resident_type: "OWNER",
          society_id: societyBId,
        });

      expect(assignRes.status).toBe(200);

      // 3. User's primary society_id should NOT be overwritten (it must still be societyAId)
      await residentSocA.reload();
      expect(residentSocA.society_id).toBe(societyAId);

      // 4. User should now have UserSociety records for BOTH Society A and Society B
      const allMemberships = await UserSociety.findAll({ where: { user_id: residentSocA.id } });
      const socIds = allMemberships.map((m) => m.society_id);
      expect(socIds).toContain(societyAId);
      expect(socIds).toContain(societyBId);

      // 5. FlatMembership for crossFlatB should have society_id set to Society B
      const fm = await FlatMembership.findOne({ where: { flat_id: crossFlatB.id, user_id: residentSocA.id } });
      expect(fm).toBeTruthy();
      expect(fm.society_id).toBe(societyBId);
      expect(fm.is_current).toBe(true);

      // 6. Resident should be findable when querying residents for Society A AND for Society B
      const resA = await request(app)
        .get("/api/users/resident")
        .query({ society_id: societyAId, search: assignEmail })
        .set(superAdminHeaders);
      expect(resA.status).toBe(200);
      const residentsA = resA.body.data || resA.body;
      expect(residentsA.some((r) => r.email === assignEmail)).toBe(true);

      const resB = await request(app)
        .get("/api/users/resident")
        .query({ society_id: societyBId, search: assignEmail })
        .set(superAdminHeaders);
      expect(resB.status).toBe(200);
      const residentsB = resB.body.data || resB.body;
      expect(residentsB.some((r) => r.email === assignEmail)).toBe(true);
    });
  });
});

