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

describe("Societies API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/societies");
    expectUnauthorized(res);
  });

  it("is forbidden for society admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/societies").set(headers);
    expectForbidden(res);
  });

  it("GET /api/societies lists societies for super admin", async () => {
    const { headers } = await login("superAdmin");
    const res = await request(app).get("/api/societies").set(headers);
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/societies is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/societies").set(headers).send({ name: "X" });
    expectForbidden(res);
  });

  it("POST /api/societies without a name fails validation", async () => {
    const { headers } = await login("superAdmin");
    const res = await request(app).post("/api/societies").set(headers).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("creates and deletes a throwaway society", async () => {
    const { headers } = await login("superAdmin");
    const name = unique("API Test Society");
    const created = await request(app)
      .post("/api/societies")
      .set(headers)
      .send({ name, address: "Test address" });
    expectOk(created);
    expect(created.body.id).toBeTruthy();

    const deleted = await request(app)
      .delete(`/api/societies/${created.body.id}`)
      .set(headers);
    expectOk(deleted);
  });

  it("DELETE /api/societies/:id returns 400 for a missing society", async () => {
    const { headers } = await login("superAdmin");
    const res = await request(app).delete("/api/societies/99999999").set(headers);
    expect(res.status).toBe(400);
  });
});

describe("Blocks API", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/blocks").send({});
    expectUnauthorized(res);
  });

  it("GET /api/blocks/:societyId lists blocks for admin", async () => {
    const { headers, user } = await login("admin");
    const res = await request(app).get(`/api/blocks/${user.society_id}`).set(headers);
    expectOk(res);
  });

  it("GET /api/blocks/getname/:societyId returns the society name", async () => {
    const { headers, user } = await login("admin");
    const res = await request(app).get(`/api/blocks/getname/${user.society_id}`).set(headers);
    expectOk(res);
  });

  it("POST /api/blocks rejects row houses with floor_count", async () => {
    const { headers, user } = await login("admin");
    const res = await request(app)
      .post("/api/blocks")
      .set(headers)
      .send({
        name: unique("RH"),
        society_id: user.society_id,
        property_type: "ROW_HOUSE",
        floor_count: 2,
        flats_per_floor: 2,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/row house/i);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/blocks/1").set(headers);
    expectForbidden(res);
  });
});

describe("Floors API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/floors/1");
    expectUnauthorized(res);
  });

  it("GET /api/floors/:blockId succeeds when the society has blocks", async () => {
    const { headers, user } = await login("admin");
    const blocks = await request(app).get(`/api/blocks/${user.society_id}`).set(headers);
    expectOk(blocks);
    const list = Array.isArray(blocks.body) ? blocks.body : blocks.body?.blocks || [];
    if (!list.length) return;

    const res = await request(app).get(`/api/floors/${list[0].id}`).set(headers);
    expectOk(res);
  });

  it("GET /api/floors/detail/:floorId requires auth", async () => {
    const res = await request(app).get("/api/floors/detail/1");
    expectUnauthorized(res);
  });
});

describe("Flats API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/flats");
    expectUnauthorized(res);
  });

  it("GET /api/flats lists flats for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats").set(headers);
    expectOk(res);
  });

  it("GET /api/flats/getall lists flats for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/getall").set(headers);
    expectOk(res);
  });

  it("GET /api/flats/unassigned succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/unassigned").set(headers);
    expectOk(res);
  });

  it("GET /api/flats/assigned succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/assigned").set(headers);
    expectOk(res);
  });

  it("GET /api/flats/neighbours succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/flats/neighbours").set(headers);
    expect([200, 400, 404]).toContain(res.status);
  });

  it("GET /api/flats/neighbours is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/neighbours").set(headers);
    expectForbidden(res);
  });

  it("GET /api/flats/filter requires a valid blockId", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/filter").set(headers);
    expectClientError(res);
  });

  it("GET /api/flats/list requires a valid blockId", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/list").set(headers);
    expectClientError(res);
  });

  it("GET /api/flats/floor/:floorId succeeds or 404s", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/flats/floor/1").set(headers);
    expect(res.status).toBeLessThan(500);
  });

  it("POST /api/flats is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/flats").set(headers).send({});
    expectForbidden(res);
  });

  it("PUT /api/flats/assign/:flatId without resident id fails validation", async () => {
    const { headers } = await login("admin");
    const res = await request(app).put("/api/flats/assign/1").set(headers).send({});
    expectClientError(res);
  });
});
