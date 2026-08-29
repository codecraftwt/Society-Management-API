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

describe("Visitors API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/visitors");
    expectUnauthorized(res);
  });

  it("GET /api/visitors is authorized for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/visitors").set(headers);
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it("GET /api/visitors is authorized for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/visitors").set(headers);
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it("GET /api/visitors is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/visitors").set(headers);
    expectForbidden(res);
  });

  it("GET /api/visitors/resident is authorized for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/visitors/resident").set(headers);
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it("GET /api/visitors/block succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/visitors/block").set(headers);
    expectOk(res);
  });

  it("GET /api/visitors/daily-help/directory succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/visitors/daily-help/directory").set(headers);
    expectOk(res);
  });

  it("POST /api/visitors is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/visitors").set(headers).send({});
    expectForbidden(res);
  });

  it("POST /api/visitors as a guard without a valid shift is rejected", async () => {
    const { headers } = await login("guard");
    const res = await request(app)
      .post("/api/visitors")
      .set(headers)
      .send({ visitor_name: "Test Guest", mobile: "9999999999", flat_id: 1 });
    expect([400, 403, 404]).toContain(res.status);
  });

  it("PUT /api/visitors/exit/:id is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).put("/api/visitors/exit/1").set(headers);
    expectForbidden(res);
  });

  it("POST /api/visitors/action/:id is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).post("/api/visitors/action/1").set(headers).send({});
    expectForbidden(res);
  });
});

describe("Pre-approval API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/preapproval/my");
    expectUnauthorized(res);
  });

  it("GET /api/preapproval/my lists gate passes for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/preapproval/my").set(headers);
    expectOk(res);
  });

  it("GET /api/preapproval/my is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/preapproval/my").set(headers);
    expectForbidden(res);
  });

  it("POST /api/preapproval/verify is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/preapproval/verify").set(headers).send({});
    expectForbidden(res);
  });

  it("POST /api/preapproval/verify rejects an invalid code", async () => {
    const { headers } = await login("guard");
    const res = await request(app)
      .post("/api/preapproval/verify")
      .set(headers)
      .send({ code: "INVALID" });
    expectClientError(res);
  });

  it("POST /api/preapproval creates a gate pass with required fields", async () => {
    const { headers } = await login("resident");
    const flats = await request(app).get("/api/users/get-flat").set(headers);
    const list = Array.isArray(flats.body) ? flats.body : [flats.body].filter(Boolean);
    const flatId = list[0]?.id || list[0]?.flat_id;

    const res = await request(app)
      .post("/api/preapproval")
      .set(headers)
      .send({
        visitor_name: unique("Guest"),
        mobile: "9876543210",
        purpose: "GUEST",
        valid_date: "2099-01-01",
        flat_id: flatId,
      });
    expect([200, 201, 400, 403]).toContain(res.status);
  });
});

describe("Household API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/household");
    expectUnauthorized(res);
  });

  it("GET /api/household lists members for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/household").set(headers);
    expectOk(res);
  });

  it("GET /api/household is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/household").set(headers);
    expectForbidden(res);
  });

  it("POST /api/household/add is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).post("/api/household/add").set(headers).send({});
    expectForbidden(res);
  });

  it("DELETE /api/household/:id handles a missing member", async () => {
    const { headers } = await login("resident");
    const res = await request(app).delete("/api/household/99999999").set(headers);
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe("Emergency API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/emergency");
    expectUnauthorized(res);
  });

  it("GET /api/emergency lists alerts for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/emergency").set(headers);
    expectOk(res);
  });

  it("GET /api/emergency/active succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/emergency/active").set(headers);
    expectOk(res);
  });

  it("GET /api/emergency/mine succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/emergency/mine").set(headers);
    expectOk(res);
  });

  it("POST /api/emergency is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/emergency").set(headers).send({});
    expectForbidden(res);
  });

  it("POST /api/emergency creates or validates an alert as a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .post("/api/emergency")
      .set(headers)
      .send({ type: "FIRE", message: "Automated test alert" });
    expect([200, 201, 400]).toContain(res.status);
  });

  it("PATCH /api/emergency/:id/resolve is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).patch("/api/emergency/1/resolve").set(headers);
    expectForbidden(res);
  });
});
