const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
  expectOk,
} = require("./helpers/api");

/* Regression tests for the /api/reports/financial society-scope fix.
   A non-Super-Admin must be hard-pinned to their own society; a client-supplied
   ?society_id query or x-society-id header must never widen that scope.
   Super Admin retains the legitimate ability to narrow to a selected society. */

const authOnly = (headers) => ({ Authorization: headers.Authorization });

describe("Financial report society isolation", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/reports/financial");
    expectUnauthorized(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/reports/financial").set(headers);
    expectForbidden(res);
  });

  it("society admin: a ?society_id query cannot change the scope", async () => {
    const { headers, user } = await login("admin");
    const own = await request(app).get("/api/reports/financial").set(authOnly(headers));
    expectOk(own);

    const foreign = (Number(user?.society_id) || 1) + 987654;
    const spoofed = await request(app)
      .get(`/api/reports/financial?society_id=${foreign}`)
      .set(authOnly(headers));
    expectOk(spoofed);

    expect(spoofed.body?.counts?.total).toBe(own.body?.counts?.total);
    expect(spoofed.body?.counts?.collected).toBe(own.body?.counts?.collected);
    expect(spoofed.body?.counts?.due).toBe(own.body?.counts?.due);
  });

  it("society admin: an x-society-id header cannot widen the scope", async () => {
    const { headers, user } = await login("admin");
    const own = await request(app).get("/api/reports/financial").set(authOnly(headers));
    expectOk(own);

    const foreign = (Number(user?.society_id) || 1) + 987654;
    const spoofed = await request(app)
      .get("/api/reports/financial")
      .set({ ...authOnly(headers), "x-society-id": String(foreign) });
    expectOk(spoofed);

    expect(spoofed.body?.counts?.total).toBe(own.body?.counts?.total);
    expect(spoofed.body?.counts?.collected).toBe(own.body?.counts?.collected);
  });

  it("committee member can access and is society-pinned", async () => {
    const { headers } = await login("committee");
    const res = await request(app).get("/api/reports/financial").set(authOnly(headers));
    expectOk(res);
  });

  it("accountant can access and a ?society_id query cannot widen the scope", async () => {
    const { headers, user } = await login("accountant");
    const own = await request(app).get("/api/reports/financial").set(authOnly(headers));
    expectOk(own);

    const foreign = (Number(user?.society_id) || 1) + 987654;
    const spoofed = await request(app)
      .get(`/api/reports/financial?society_id=${foreign}`)
      .set(authOnly(headers));
    expectOk(spoofed);
    expect(spoofed.body?.counts?.total).toBe(own.body?.counts?.total);
  });

  it("super admin can narrow the report to a selected society", async () => {
    const admin = await login("admin");
    const own = await request(app).get("/api/reports/financial").set(authOnly(admin.headers));
    expectOk(own);

    const superAdmin = await login("superAdmin");
    const narrowed = await request(app)
      .get("/api/reports/financial")
      .set({ ...authOnly(superAdmin.headers), "x-society-id": String(admin.user.society_id) });
    expectOk(narrowed);

    if (Number.isInteger(Number(admin.user?.society_id))) {
      expect(narrowed.body?.counts?.total).toBe(own.body?.counts?.total);
    }
  });

  it("super admin with an invalid x-society-id still succeeds (degrades to global)", async () => {
    const { headers } = await login("superAdmin");
    const res = await request(app)
      .get("/api/reports/financial")
      .set({ ...authOnly(headers), "x-society-id": "abc" });
    expectOk(res);
  });
});
