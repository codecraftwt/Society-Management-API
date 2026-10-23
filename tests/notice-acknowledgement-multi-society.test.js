const request = require("supertest");
const app = require("../app");
const { login } = require("./helpers/api");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const Society = require("../models/Society");
const Block = require("../models/Block");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const Notice = require("../models/Notice");
const NoticeAcknowledgement = require("../models/NoticeAcknowledgement");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/**
 * Regression coverage for the notice acknowledgement history report.
 *
 * `users.society_id` only stores a user's PRIMARY society. A resident who owns
 * a flat in one society while their primary society is another one is a valid
 * audience member (the resident-facing notice list is membership based), so
 * the admin acknowledgement history must include them too.
 *
 * Before the fix the report filtered recipients with
 * `users.society_id = notice.society_id`, which silently dropped such
 * residents even though their acknowledgement had been recorded.
 */
describe("Notice Acknowledgement History — multi-society residents", () => {
  let superAdminHeaders;
  let noticeSocietyId;
  let primarySocietyId;
  let flatId;
  let residentUser;
  let residentToken;
  let pendingUser;
  let createdNoticeIds = [];

  const stamp = Date.now();
  const residentEmail = `notice_multi_resident_${stamp}@example.com`;
  const pendingEmail = `notice_multi_pending_${stamp}@example.com`;
  const password = "Password@123";

  const signToken = (user, societyId) =>
    jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        society_id: societyId,
        activeSocietyId: societyId,
      },
      process.env.JWT_SECRET || "testsecret",
      { expiresIn: "1h" }
    );

  beforeAll(async () => {
    const superAdminSession = await login("superAdmin");
    superAdminHeaders = superAdminSession.headers;

    const noticeSociety = await Society.create({
      name: `Notice Target Society ${stamp}`,
      address: "Notice Target Street",
    });
    noticeSocietyId = noticeSociety.id;

    const primarySociety = await Society.create({
      name: `Notice Primary Society ${stamp}`,
      address: "Notice Primary Street",
    });
    primarySocietyId = primarySociety.id;

    const block = await Block.create({
      name: `Notice Block ${stamp}`,
      society_id: noticeSocietyId,
    });

    const flat = await Flat.create({
      flat_number: `N-${stamp.toString().slice(-5)}`,
      block_id: block.id,
    });
    flatId = flat.id;

    // Resident whose PRIMARY society differs from the notice society.
    residentUser = await User.create({
      name: "Multi Society Notice Resident",
      email: residentEmail,
      password: await bcrypt.hash(password, 8),
      role: "RESIDENT",
      roles: ["RESIDENT"],
      society_id: primarySocietyId,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    const residentMembership = await UserSociety.create({
      user_id: residentUser.id,
      society_id: noticeSocietyId,
      membership_status: "ACTIVE",
      role: "RESIDENT",
      resident_type: "OWNER",
    });
    await UserSocietyRole.create({
      user_society_id: residentMembership.id,
      role: "RESIDENT",
    });

    await UserSociety.create({
      user_id: residentUser.id,
      society_id: primarySocietyId,
      membership_status: "ACTIVE",
      role: "RESIDENT",
      resident_type: "OWNER",
    });

    await FlatMembership.create({
      user_id: residentUser.id,
      flat_id: flatId,
      society_id: noticeSocietyId,
      role: "OWNER",
      is_current: true,
    });

    // Second resident whose membership in the notice society is not ACTIVE.
    pendingUser = await User.create({
      name: "Pending Membership Resident",
      email: pendingEmail,
      password: await bcrypt.hash(password, 8),
      role: "RESIDENT",
      roles: ["RESIDENT"],
      society_id: primarySocietyId,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    await UserSociety.create({
      user_id: pendingUser.id,
      society_id: noticeSocietyId,
      membership_status: "PENDING",
      role: "RESIDENT",
      resident_type: "OWNER",
    });

    await FlatMembership.create({
      user_id: pendingUser.id,
      flat_id: flatId,
      society_id: noticeSocietyId,
      role: "TENANT",
      is_current: true,
    });

    residentToken = signToken(residentUser, noticeSocietyId);
  });

  afterAll(async () => {
    if (createdNoticeIds.length) {
      await NoticeAcknowledgement.destroy({
        where: { notice_id: { [require("sequelize").Op.in]: createdNoticeIds } },
      });
      await Notice.destroy({ where: { id: { [require("sequelize").Op.in]: createdNoticeIds } } });
    }
    const { Op } = require("sequelize");
    await FlatMembership.destroy({ where: { flat_id: flatId } });
    await UserSocietyRole.destroy({
      where: {
        user_society_id: {
          [Op.in]: (
            await UserSociety.findAll({
              where: { user_id: { [Op.in]: [residentUser.id, pendingUser.id] } },
              attributes: ["id"],
            })
          ).map((m) => m.id),
        },
      },
    });
    await UserSociety.destroy({
      where: { user_id: { [Op.in]: [residentUser.id, pendingUser.id] } },
    });
    await User.destroy({ where: { id: { [Op.in]: [residentUser.id, pendingUser.id] } } });
    await Flat.destroy({ where: { id: flatId } });
    await Block.destroy({ where: { society_id: noticeSocietyId } });
    await Society.destroy({
      where: { id: { [Op.in]: [noticeSocietyId, primarySocietyId] } },
    });
  });

  const createNotice = async (overrides = {}) => {
    const res = await request(app)
      .post("/api/notices")
      .set(superAdminHeaders)
      .send({
        title: `Notice Multi ${stamp} ${Math.floor(Math.random() * 1000)}`,
        description: "Multi-society acknowledgement regression notice",
        acknowledgement_required: true,
        society_id: noticeSocietyId,
        ...overrides,
      });
    expect([200, 201]).toContain(res.status);
    const id = res.body?.id || res.body?.notice?.id;
    expect(id).toBeTruthy();
    createdNoticeIds.push(id);
    return id;
  };

  const acknowledge = async (noticeId) => {
    const viewRes = await request(app)
      .post(`/api/notices/${noticeId}/view`)
      .set({ Authorization: `Bearer ${residentToken}` });
    expect(viewRes.status).toBe(200);

    const ackRes = await request(app)
      .post(`/api/notices/${noticeId}/acknowledge`)
      .set({ Authorization: `Bearer ${residentToken}` });
    expect(ackRes.status).toBe(200);
    return ackRes.body;
  };

  it("lists a flat-targeted notice to a resident whose primary society differs", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });

    const listRes = await request(app)
      .get("/api/notices")
      .set({ Authorization: `Bearer ${residentToken}` });

    expect(listRes.status).toBe(200);
    const notices = listRes.body?.data || listRes.body?.notices || listRes.body;
    expect(notices.some((n) => n.id === noticeId)).toBe(true);
  });

  it("records the acknowledgement for a multi-society resident", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });
    const ack = await acknowledge(noticeId);
    expect(ack.acknowledgement_status).toBe("ACKNOWLEDGED");
    expect(ack.acknowledged_at).toBeTruthy();
  });

  it("shows the multi-society resident as ACKNOWLEDGED in the admin history", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });
    await acknowledge(noticeId);

    const histRes = await request(app)
      .get(`/api/notices/${noticeId}/acknowledgements`)
      .set(superAdminHeaders);

    expect(histRes.status).toBe(200);

    const users = histRes.body?.users || [];
    const row = users.find((u) => u.email === residentEmail);

    // The regression: the resident must be present even though their primary
    // society (users.society_id) is a different society.
    expect(row).toBeTruthy();
    expect(row.status).toBe("ACKNOWLEDGED");
    expect(row.acknowledged_at).toBeTruthy();
    expect(row.viewed_at).toBeTruthy();

    expect(histRes.body?.summary?.total).toBeGreaterThanOrEqual(1);
    expect(histRes.body?.summary?.acknowledged).toBeGreaterThanOrEqual(1);
    expect(histRes.body?.summary?.pending).toBe(
      histRes.body.summary.total - histRes.body.summary.acknowledged
    );
  });

  it("keeps society-wide notice recipients membership based", async () => {
    const noticeId = await createNotice({ target_type: "SOCIETY" });
    await acknowledge(noticeId);

    const histRes = await request(app)
      .get(`/api/notices/${noticeId}/acknowledgements`)
      .set(superAdminHeaders);

    expect(histRes.status).toBe(200);
    const users = histRes.body?.users || [];
    const row = users.find((u) => u.email === residentEmail);
    expect(row).toBeTruthy();
    expect(row.status).toBe("ACKNOWLEDGED");
  });

  it("excludes residents whose membership in the society is not ACTIVE", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });
    await acknowledge(noticeId);

    const histRes = await request(app)
      .get(`/api/notices/${noticeId}/acknowledgements`)
      .set(superAdminHeaders);

    expect(histRes.status).toBe(200);
    const users = histRes.body?.users || [];
    expect(users.some((u) => u.email === pendingEmail)).toBe(false);
  });

  it("filters the history by acknowledgement status", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });
    await acknowledge(noticeId);

    const ackedRes = await request(app)
      .get(`/api/notices/${noticeId}/acknowledgements`)
      .query({ status: "ACKNOWLEDGED" })
      .set(superAdminHeaders);

    expect(ackedRes.status).toBe(200);
    const ackedUsers = ackedRes.body?.users || [];
    expect(ackedUsers.length).toBeGreaterThanOrEqual(1);
    expect(ackedUsers.every((u) => u.status === "ACKNOWLEDGED")).toBe(true);
    expect(ackedUsers.some((u) => u.email === residentEmail)).toBe(true);
  });

  it("prevents a resident from reading the acknowledgement history", async () => {
    const noticeId = await createNotice({ target_type: "FLAT", target_flat_id: flatId });
    await acknowledge(noticeId);

    const res = await request(app)
      .get(`/api/notices/${noticeId}/acknowledgements`)
      .set({ Authorization: `Bearer ${residentToken}` });

    expect(res.status).toBe(403);
  });
});
