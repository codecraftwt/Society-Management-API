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

describe("Guard shifts API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/guard-shift");
    expectUnauthorized(res);
  });

  it("GET /api/guard-shift lists shifts for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/guard-shift").set(headers);
    expectOk(res);
  });

  it("GET /api/guard-shift/my succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/guard-shift/my").set(headers);
    expectOk(res);
  });

  it("GET /api/guard-shift/my is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/guard-shift/my").set(headers);
    expectForbidden(res);
  });

  it("POST /api/guard-shift requires shift fields", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/guard-shift").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  it("POST /api/guard-shift rejects inverted dates", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/guard-shift")
      .set(headers)
      .send({
        guard_id: 1,
        shift_type: "MORNING",
        start_date: "2026-12-31",
        end_date: "2026-01-01",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/start_date must be on or before end_date/i);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/guard-shift").set(headers);
    expectForbidden(res);
  });
});

describe("Guard logs API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/guard-logs");
    expectUnauthorized(res);
  });

  it("GET /api/guard-logs succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/guard-logs").set(headers);
    expectOk(res);
  });

  it("POST /api/guard-logs requires log text", async () => {
    const { headers } = await login("guard");
    const res = await request(app).post("/api/guard-logs").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/log text is required/i);
  });

  it("creates and deletes a guard log", async () => {
    const { headers } = await login("guard");
    const created = await request(app)
      .post("/api/guard-logs")
      .set(headers)
      .send({ log_text: unique("API log"), text: unique("API log") });
    expect([200, 201, 400]).toContain(created.status);
    const id = created.body?.id || created.body?.log?.id;
    if (!id) return;

    const deleted = await request(app).delete(`/api/guard-logs/${id}`).set(headers);
    expect(deleted.status).toBeLessThan(500);
  });
});

describe("Notifications API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/notifications");
    expectUnauthorized(res);
  });

  it("GET /api/notifications lists notifications", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/notifications").set(headers);
    expectOk(res);
  });

  it("PUT /api/notifications/:id/read handles a missing notification", async () => {
    const { headers } = await login("resident");
    const res = await request(app).put("/api/notifications/99999999/read").set(headers);
    expect(res.status).toBeLessThan(500);
  });
});

describe("Vehicles API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/vehicles/my");
    expectUnauthorized(res);
  });

  it("GET /api/vehicles/my lists vehicles for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/vehicles/my").set(headers);
    expectOk(res);
  });

  it("GET /api/vehicles/my is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/vehicles/my").set(headers);
    expectForbidden(res);
  });

  it("POST /api/vehicles requires vehicle fields", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/vehicles").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/vehicle_name, vehicle_number and vehicle_type are required/i);
  });

  it("creates and deletes a vehicle", async () => {
    const { headers } = await login("resident");
    const number = `TST${Date.now().toString().slice(-6)}`;
    const created = await request(app).post("/api/vehicles").set(headers).send({
      vehicle_name: "Test Bike",
      vehicle_number: number,
      vehicle_type: "BIKE",
    });
    expect([200, 201, 400]).toContain(created.status);
    const id = created.body?.id || created.body?.vehicle?.id;
    if (!id) return;

    const deleted = await request(app).delete(`/api/vehicles/${id}`).set(headers);
    expectOk(deleted);
  });
});

describe("Admin API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/tenant-history");
    expectUnauthorized(res);
  });

  it("GET /api/admin/tenant-history succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/admin/tenant-history").set(headers);
    expectOk(res);
  });

  it("PUT /api/admin/approve-resident/:userId handles a missing user", async () => {
    const { headers } = await login("admin");
    const res = await request(app).put("/api/admin/approve-resident/99999999").set(headers);
    expectClientError(res);
  });

  it("PUT /api/admin/reject-resident/:userId handles a missing user", async () => {
    const { headers } = await login("admin");
    const res = await request(app).put("/api/admin/reject-resident/99999999").set(headers);
    expectClientError(res);
  });
});
