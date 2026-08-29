const {
  request,
  app,
  login,
  ACCOUNTS,
  expectUnauthorized,
  expectInvalidToken,
  expectForbidden,
  expectOk,
} = require("./helpers/api");

describe("Auth API", () => {
  describe("POST /api/auth/login", () => {
    it("returns 400 when email and password are missing", async () => {
      const res = await request(app).post("/api/auth/login").send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email and password are required/i);
    });

    it("returns 400 for unknown user", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "Admin@123" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/user not found/i);
    });

    it("returns 400 for invalid credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: ACCOUNTS.admin.email, password: "WrongPass@1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it("sends OTP for valid credentials", async () => {
      const res = await request(app).post("/api/auth/login").send(ACCOUNTS.admin);
      expectOk(res);
      expect(res.body.tempToken).toBeTruthy();
      expect(res.body.user.email).toBe(ACCOUNTS.admin.email);
    });
  });

  describe("POST /api/auth/verify-otp", () => {
    it("returns 400 when otp and tempToken are missing", async () => {
      const res = await request(app).post("/api/auth/verify-otp").send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/otp and session token are required/i);
    });

    it("returns 401 for an invalid session token", async () => {
      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ otp: "123456", tempToken: "not-a-jwt" });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid session/i);
    });

    it("returns 400 for an incorrect OTP", async () => {
      const loginRes = await request(app).post("/api/auth/login").send(ACCOUNTS.resident);
      expectOk(loginRes);

      const res = await request(app).post("/api/auth/verify-otp").send({
        otp: "000000",
        tempToken: loginRes.body.tempToken,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/incorrect otp/i);
    });

    it("issues a JWT for a valid OTP", async () => {
      const loginRes = await request(app).post("/api/auth/login").send(ACCOUNTS.guard);
      expectOk(loginRes);

      const res = await request(app).post("/api/auth/verify-otp").send({
        otp: "123456",
        tempToken: loginRes.body.tempToken,
      });
      expectOk(res);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.email).toBe(ACCOUNTS.guard.email);
    });
  });

  describe("POST /api/auth/resend-otp", () => {
    it("returns 400 when session token is missing", async () => {
      const res = await request(app).post("/api/auth/resend-otp").send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/session token is required/i);
    });

    it("returns 401 for an expired/invalid session", async () => {
      const res = await request(app)
        .post("/api/auth/resend-otp")
        .send({ tempToken: "bad-token" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/register", () => {
    it("returns 400 when society is missing", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Test User",
        email: "newuser@example.com",
        password: "Admin@123",
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/society is required/i);
    });

    it("returns 400 for a weak password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Test User",
        email: `weak-${Date.now()}@example.com`,
        password: "weak",
        society_id: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password must be at least 8/i);
    });

    it("returns 400 when the email already exists", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Admin Duplicate",
        email: ACCOUNTS.admin.email,
        password: "Admin@123",
        society_id: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe("GET /api/auth/approval-status/:id", () => {
    it("returns 404 for a missing user", async () => {
      const res = await request(app).get("/api/auth/approval-status/99999999");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/auth/switch-role", () => {
    it("requires authentication", async () => {
      const res = await request(app).post("/api/auth/switch-role").send({ role: "RESIDENT" });
      expectUnauthorized(res);
    });

    it("rejects an invalid token", async () => {
      const res = await request(app)
        .post("/api/auth/switch-role")
        .set("Authorization", "Bearer invalid.token.here")
        .send({ role: "RESIDENT" });
      expectInvalidToken(res);
    });

    it("returns 400 when role is missing", async () => {
      const { headers } = await login("admin");
      const res = await request(app).post("/api/auth/switch-role").set(headers).send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/role is required/i);
    });

    it("returns 403 when switching to an unassigned role", async () => {
      const { headers } = await login("resident");
      const res = await request(app)
        .post("/api/auth/switch-role")
        .set(headers)
        .send({ role: "SUPER_ADMIN" });
      expectForbidden(res);
    });
  });
});
