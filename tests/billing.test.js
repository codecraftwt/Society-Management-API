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

describe("Bills API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/bills/society");
    expectUnauthorized(res);
  });

  it("GET /api/bills/society lists bills for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/bills/society").set(headers);
    expectOk(res);
  });

  it("GET /api/bills/society is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/bills/society").set(headers);
    expectForbidden(res);
  });

  it("GET /api/bills/resident lists bills for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/bills/resident").set(headers);
    expectOk(res);
  });

  it("POST /api/bills is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/bills").set(headers).send({});
    expectForbidden(res);
  });

  it("POST /api/bills validates an unassigned flat for individual bills", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/bills").set(headers).send({
      bill_type: "INDIVIDUAL",
      flat_id: 99999999,
      title: "Test",
      amount: 100,
      billing_month: "2026-08",
    });
    expectClientError(res);
  });

  it("PUT /api/bills/confirm/:id handles a missing bill", async () => {
    const { headers } = await login("admin");
    const res = await request(app).put("/api/bills/confirm/99999999").set(headers);
    expect(res.status).toBeLessThan(500);
  });

  it("DELETE /api/bills/:id handles a missing bill", async () => {
    const { headers } = await login("admin");
    const res = await request(app).delete("/api/bills/99999999").set(headers);
    expect(res.status).toBeLessThan(500);
  });
});

describe("Billing rules API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/billing-rules");
    expectUnauthorized(res);
  });

  it("GET /api/billing-rules lists rules for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/billing-rules").set(headers);
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/billing-rules requires a name", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/billing-rules")
      .set(headers)
      .send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name is required/i);
  });

  it("POST /api/billing-rules requires a numeric amount", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/billing-rules")
      .set(headers)
      .send({ name: "X" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/amount is required/i);
  });

  it("POST /api/billing-rules rejects an invalid frequency", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/billing-rules")
      .set(headers)
      .send({ name: "X", amount: 10, frequency: "WEEKLY" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/frequency must be one of/i);
  });

  it("creates and deletes a billing rule", async () => {
    const { headers } = await login("admin");
    const created = await request(app)
      .post("/api/billing-rules")
      .set(headers)
      .send({ name: unique("Rule"), amount: 50, frequency: "MONTHLY" });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();

    const deleted = await request(app)
      .delete(`/api/billing-rules/${created.body.id}`)
      .set(headers);
    expectOk(deleted);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/billing-rules").set(headers);
    expectForbidden(res);
  });
});

describe("Payments API", () => {
  it("requires authentication for create-order", async () => {
    const res = await request(app).post("/api/payments/create-order").send({});
    expectUnauthorized(res);
  });

  it("POST /api/payments/create-order is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/payments/create-order").set(headers).send({});
    expectForbidden(res);
  });

  it("POST /api/payments/create-order requires bill_id", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/payments/create-order").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bill_id is required/i);
  });

  it("POST /api/payments/verify requires authentication", async () => {
    const res = await request(app).post("/api/payments/verify").send({});
    expectUnauthorized(res);
  });

  it("POST /api/payments/demo-upi requires bill_id", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/payments/demo-upi").set(headers).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bill_id is required/i);
  });

  it("POST /api/payments/demo-verify requires bill_id", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/payments/demo-verify").set(headers).send({});
    expect(res.status).toBe(400);
  });

  it("GET /api/payments/debug-bills returns bills", async () => {
    const res = await request(app).get("/api/payments/debug-bills");
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("Accountant API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/accountant/bills");
    expectUnauthorized(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/accountant/bills").set(headers);
    expectForbidden(res);
  });

  it("GET /api/accountant/bills succeeds for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/accountant/bills").set(headers);
    expectOk(res);
  });

  it("GET /api/accountant/payments succeeds for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/accountant/payments").set(headers);
    expectOk(res);
  });

  it("GET /api/accountant/payments/summary succeeds for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/accountant/payments/summary").set(headers);
    expectOk(res);
  });

  it("GET /api/accountant/dashboard-stats succeeds for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/accountant/dashboard-stats").set(headers);
    expectOk(res);
    expect(typeof res.body.totalBills).toBe("number");
    expect(typeof res.body.paidBills).toBe("number");
    expect(typeof res.body.pendingBills).toBe("number");
    expect(typeof res.body.totalCollected).toBe("number");
    expect(typeof res.body.totalDue).toBe("number");
  });

  it("GET /api/accountant/dashboard-stats requires authentication", async () => {
    const res = await request(app).get("/api/accountant/dashboard-stats");
    expectUnauthorized(res);
  });

  it("GET /api/accountant/dashboard-stats is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/accountant/dashboard-stats").set(headers);
    expectForbidden(res);
  });

  it("GET /api/reports/financial succeeds for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/reports/financial").set(headers);
    expectOk(res);
  });
});
