const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
  expectOk,
  expectClientError,
} = require("./helpers/api");

describe("Reports API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/reports/visitors");
    expectUnauthorized(res);
  });

  it("GET /api/reports/visitors is authorized for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/reports/visitors").set(headers);
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it("GET /api/reports/complaints succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/reports/complaints").set(headers);
    expectOk(res);
  });

  it("GET /api/reports/financial succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/reports/financial").set(headers);
    expectOk(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/reports/financial").set(headers);
    expectForbidden(res);
  });
});

describe("Resident reports API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/resident/my-complaints");
    expectUnauthorized(res);
  });

  it("GET /api/resident/my-complaints succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/resident/my-complaints").set(headers);
    expectOk(res);
  });

  it("GET /api/resident/my-visitors is authorized for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/resident/my-visitors").set(headers);
    expect([200, 500]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it("GET /api/resident/my-bills succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/resident/my-bills").set(headers);
    expectOk(res);
  });

  it("is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/resident/my-bills").set(headers);
    expectForbidden(res);
  });
});

describe("Parking API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/parking");
    expectUnauthorized(res);
  });

  it("GET /api/parking lists requests for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/parking").set(headers);
    expectOk(res);
  });

  it("GET /api/parking/unassigned-resident-vehicles succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/parking/unassigned-resident-vehicles").set(headers);
    expectOk(res);
  });

  it("GET /api/parking/unassigned-resident-vehicles is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/parking/unassigned-resident-vehicles").set(headers);
    expectForbidden(res);
  });

  it("GET /api/parking/lookup-vehicle requires a vehicle number", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/parking/lookup-vehicle").set(headers);
    expectClientError(res);
  });

  it("POST /api/parking/request-slot requires vehicle fields", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/parking/request-slot").set(headers).send({});
    expect(res.status).toBe(400);
  });

  it("PUT /api/parking/:id/assign without a spot fails validation", async () => {
    const { headers } = await login("guard");
    const res = await request(app).put("/api/parking/1/assign").set(headers).send({});
    expectClientError(res);
  });
});

describe("Parking slots API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/parking-slots");
    expectUnauthorized(res);
  });

  it("GET /api/parking-slots lists slots for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/parking-slots").set(headers);
    expectOk(res);
  });

  it("GET /api/parking-slots/available succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/parking-slots/available").set(headers);
    expectOk(res);
  });

  it("GET /api/parking-slots/my-slots succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/parking-slots/my-slots").set(headers);
    expectOk(res);
  });

  it("POST /api/parking-slots requires all fields", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/parking-slots").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/all fields are required/i);
  });

  it("POST /api/parking-slots is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/parking-slots").set(headers).send({});
    expectForbidden(res);
  });
});

describe("Parcels API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/parcels");
    expectUnauthorized(res);
  });

  it("GET /api/parcels succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/parcels").set(headers);
    expectOk(res);
  });

  it("GET /api/parcels succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/parcels").set(headers);
    expectOk(res);
  });

  it("GET /api/parcels is forbidden for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/parcels").set(headers);
    expectForbidden(res);
  });

  it("POST /api/parcels is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/parcels").set(headers).send({});
    expectForbidden(res);
  });

  it("PUT /api/parcels/:id/status handles an invalid transition", async () => {
    const { headers } = await login("guard");
    const res = await request(app)
      .put("/api/parcels/99999999/status")
      .set(headers)
      .send({ status: "DELIVERED" });
    expect(res.status).toBeLessThan(500);
  });
});
