const {
  request,
  app,
  login,
  unique,
  expectUnauthorized,
  expectForbidden,
  expectOk,
  expectClientError,
} = require("./helpers/api");

describe("Users API", () => {
  it("rejects unauthenticated access to protected user routes", async () => {
    const res = await request(app).get("/api/users/me");
    expectUnauthorized(res);
  });

  it("GET /api/users/me returns the logged-in profile", async () => {
    const { headers, user } = await login("admin");
    const res = await request(app).get("/api/users/me").set(headers);
    expectOk(res);
    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe(user.email);
  });

  it("PUT /api/users/me requires current password when changing password", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .put("/api/users/me")
      .set(headers)
      .send({ password: "NewPass@123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/current password is required/i);
  });

  it("PUT /api/users/me updates name without a password", async () => {
    const { headers, user } = await login("resident");
    const res = await request(app)
      .put("/api/users/me")
      .set(headers)
      .send({ name: user.name });
    expectOk(res);
  });

  it("GET /api/users/resident lists residents for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/resident").set(headers);
    expectOk(res);
  });

  it("GET /api/users/resident is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/users/resident").set(headers);
    expectForbidden(res);
  });

  it("POST /api/users/resident validates missing flat assignment", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/users/resident")
      .set(headers)
      .send({
        name: "No Flat",
        email: `${unique("nofeat")}@yopmail.com`,
        password: "Admin@123",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/flat assignment is required/i);
  });

  it("GET /api/users/resident/unassigned succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/resident/unassigned").set(headers);
    expectOk(res);
  });

  it("GET /api/users/resident/pending succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/resident/pending").set(headers);
    expectOk(res);
  });

  it("GET /api/users/guard lists guards for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/guard").set(headers);
    expectOk(res);
  });

  it("POST /api/users/guard is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/users/guard").set(headers).send({});
    expectForbidden(res);
  });

  it("GET /api/users/accountant succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/accountant").set(headers);
    expectOk(res);
  });

  it("GET /api/users/get-flat returns the resident flat", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/users/get-flat").set(headers);
    expect([200, 404]).toContain(res.status);
  });

  it("GET /api/users/get-flat is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/users/get-flat").set(headers);
    expectForbidden(res);
  });

  it("PUT /api/users/fcm-token accepts an authenticated update", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .put("/api/users/fcm-token")
      .set(headers)
      .send({ fcm_token: "test-token" });
    expect([200, 400]).toContain(res.status);
  });

  it("POST /api/users/forgot-password returns 404 for unknown email", async () => {
    const res = await request(app)
      .post("/api/users/forgot-password")
      .send({ email: "missing@example.com" });
    expect(res.status).toBe(404);
  });

  it("POST /api/users/forgot-password accepts a known email", async () => {
    const res = await request(app)
      .post("/api/users/forgot-password")
      .send({ email: "resident1@yopmail.com" });
    expectOk(res);
  });

  it("POST /api/users/reset-password rejects an invalid token", async () => {
    const res = await request(app)
      .post("/api/users/reset-password")
      .send({ token: "bad", newPassword: "Admin@123" });
    expectClientError(res);
  });

  it("POST /api/users/committee/promote is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .post("/api/users/committee/promote")
      .set(headers)
      .send({ user_id: 1 });
    expectForbidden(res);
  });

  it("POST /api/users/resident/add-tenant is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/users/resident/add-tenant")
      .set(headers)
      .send({});
    expectForbidden(res);
  });

  it("POST /api/users/resident/renew-tenant validates missing date", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .post("/api/users/resident/renew-tenant")
      .set(headers)
      .send({});
    expectClientError(res);
  });

  it("PUT /api/users/resident/:id returns an error for a missing resident", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .put("/api/users/resident/99999999")
      .set(headers)
      .send({ name: "Nope" });
    expectClientError(res);
  });

  it("POST /api/users/societies/:societyId/admin is forbidden for society admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/users/societies/1/admin")
      .set(headers)
      .send({});
    expectForbidden(res);
  });
});
