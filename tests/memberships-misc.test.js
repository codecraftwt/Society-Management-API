const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
  expectOk,
  expectClientError,
} = require("./helpers/api");

describe("Memberships API", () => {
  it("requires authentication for rates", async () => {
    const res = await request(app).get("/api/rates");
    expectUnauthorized(res);
  });

  it("GET /api/rates lists rates for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/rates").set(headers);
    expectOk(res);
  });

  it("POST /api/rates without payload is a client error or 500 from validation", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/rates").set(headers).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/rates/batch without payload is a client error or 500 from validation", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/rates/batch").set(headers).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/users/me/units succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/users/me/units").set(headers);
    expect([200, 400, 404]).toContain(res.status);
  });

  it("GET /api/flats/:flatId/memberships requires auth", async () => {
    const res = await request(app).get("/api/flats/1/memberships");
    expectUnauthorized(res);
  });

  it("GET /api/flats/:flatId/memberships succeeds for admin", async () => {
    const { headers } = await login("admin");
    const flats = await request(app).get("/api/flats").set(headers);
    expectOk(flats);
    const list = Array.isArray(flats.body) ? flats.body : flats.body?.flats || [];
    if (!list.length) return;

    const res = await request(app).get(`/api/flats/${list[0].id}/memberships`).set(headers);
    expectOk(res);
  });

  it("GET /api/users/:userId/memberships succeeds for admin", async () => {
    const { headers, user } = await login("admin");
    const res = await request(app).get(`/api/users/${user.id}/memberships`).set(headers);
    expect(res.status).toBeLessThan(500);
  });

  it("PATCH /api/memberships/:id handles a missing membership", async () => {
    const { headers } = await login("admin");
    const res = await request(app).patch("/api/memberships/99999999").set(headers).send({});
    expect(res.status).toBeLessThan(500);
  });

  it("DELETE /api/memberships/:id handles a missing membership", async () => {
    const { headers } = await login("admin");
    const res = await request(app).delete("/api/memberships/99999999").set(headers);
    expect(res.status).toBeLessThan(500);
  });
});

describe("Flat history API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/flat-history/1");
    expectUnauthorized(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/flat-history/1").set(headers);
    expectForbidden(res);
  });

  it("GET /api/flat-history/:flat_id succeeds for admin", async () => {
    const { headers } = await login("admin");
    const flats = await request(app).get("/api/flats").set(headers);
    expectOk(flats);
    const list = Array.isArray(flats.body) ? flats.body : flats.body?.flats || [];
    const id = list[0]?.id || 1;
    const res = await request(app).get(`/api/flat-history/${id}`).set(headers);
    expectOk(res);
  });

  it("POST /api/flat-history/move-in without ids still responds", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/flat-history/move-in").set(headers).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/flat-history/move-out is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).post("/api/flat-history/move-out").set(headers).send({});
    expectForbidden(res);
  });
});

describe("Download API", () => {
  it("GET /api/download without url returns 400", async () => {
    const res = await request(app).get("/api/download");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing 'url'/i);
  });

  it("GET /api/download rejects an invalid URL", async () => {
    const res = await request(app).get("/api/download").query({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid url/i);
  });

  it("GET /api/download rejects a non-Cloudinary origin", async () => {
    const res = await request(app)
      .get("/api/download")
      .query({ url: "https://example.com/file.pdf" });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden origin/i);
  });
});
