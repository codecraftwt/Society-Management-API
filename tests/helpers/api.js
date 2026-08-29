const request = require("supertest");
const app = require("../../app");

const ACCOUNTS = {
  superAdmin: { email: "superadmin@society.com", password: "123456" },
  admin: { email: "admin@yopmail.com", password: "Admin@123" },
  committee: { email: "committee@yopmail.com", password: "Admin@123" },
  guard: { email: "guard@yopmail.com", password: "Admin@123" },
  accountant: { email: "accountant@yopmail.com", password: "Admin@123" },
  resident: { email: "resident1@yopmail.com", password: "Admin@123" },
};

const sessionCache = {};

async function login(role = "admin") {
  if (sessionCache[role]) return sessionCache[role];

  const creds = ACCOUNTS[role];
  if (!creds) throw new Error(`Unknown test role: ${role}`);

  const loginRes = await request(app).post("/api/auth/login").send(creds);
  if (loginRes.status !== 200 || !loginRes.body.tempToken) {
    throw new Error(
      `Login failed for ${creds.email}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`
    );
  }

  const otpRes = await request(app).post("/api/auth/verify-otp").send({
    otp: "123456",
    tempToken: loginRes.body.tempToken,
  });

  if (otpRes.status !== 200 || !otpRes.body.token) {
    throw new Error(
      `OTP verify failed for ${creds.email}: ${otpRes.status} ${JSON.stringify(otpRes.body)}`
    );
  }

  const session = {
    token: otpRes.body.token,
    user: otpRes.body.user,
    headers: { Authorization: `Bearer ${otpRes.body.token}` },
  };

  if (session.user?.society_id) {
    session.headers["x-society-id"] = String(session.user.society_id);
  }

  sessionCache[role] = session;
  return session;
}

function auth(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function unique(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function expectUnauthorized(res) {
  expect(res.status).toBe(401);
  expect(res.body.message).toMatch(/token|authenticated/i);
}

function expectInvalidToken(res) {
  expect([401, 403]).toContain(res.status);
  expect(res.body).toHaveProperty("message");
}

function expectForbidden(res) {
  expect(res.status).toBe(403);
  expect(res.body).toHaveProperty("message");
}

function expectOk(res) {
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
}

function expectClientError(res) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
}

module.exports = {
  request,
  app,
  ACCOUNTS,
  login,
  auth,
  unique,
  expectUnauthorized,
  expectInvalidToken,
  expectForbidden,
  expectOk,
  expectClientError,
};
