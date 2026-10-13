const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
} = require("./helpers/api");

describe("Bills society-scope isolation", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/bills/society");
    expectUnauthorized(res);
  });

  it("admin cannot widen scope with a ?society_id query param", async () => {
    const { headers } = await login("admin");
    const base = await request(app).get("/api/bills/society").set(headers);
    const foreign = await request(app)
      .get("/api/bills/society?society_id=999999")
      .set(headers);

    expect(base.status).toBe(200);
    expect(foreign.status).toBe(200);
    expect(foreign.body.counts.total).toBe(base.body.counts.total);
  });

  it("admin cannot widen scope with a foreign x-society-id header", async () => {
    const { headers } = await login("admin");
    const base = await request(app).get("/api/bills/society").set(headers);
    const widened = await request(app)
      .get("/api/bills/society")
      .set({ ...headers, "x-society-id": "999999" });

    expect(widened.status).toBe(200);
    expect(widened.body.counts.total).toBe(base.body.counts.total);
  });

  it("super admin can narrow to a specific society", async () => {
    const admin = await login("admin");
    const superAdmin = await login("superAdmin");
    const adminSoc = admin.user?.society_id;
    if (!adminSoc) return;

    const narrowed = await request(app)
      .get("/api/bills/society")
      .set({ ...superAdmin.headers, "x-society-id": String(adminSoc) });
    const adminView = await request(app).get("/api/bills/society").set(admin.headers);

    expect(narrowed.status).toBe(200);
    expect(narrowed.body.counts.total).toBe(adminView.body.counts.total);
  });

  it("resident is forbidden from society bills", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/bills/society").set(headers);
    expectForbidden(res);
  });

  it("DELETE /api/bills/:id forbids a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).delete("/api/bills/1").set(headers);
    expectForbidden(res);
  });

  it("DELETE /api/bills/bulk requires an ids array", async () => {
    const { headers } = await login("admin");
    const res = await request(app).delete("/api/bills/bulk").set(headers).send({});
    expect(res.status).toBe(400);
  });
});
