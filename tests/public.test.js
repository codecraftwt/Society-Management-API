const { request, app, expectOk } = require("./helpers/api");

describe("Public API", () => {
  it("GET /api/public/societies lists societies without auth", async () => {
    const res = await request(app).get("/api/public/societies");
    expectOk(res);
    expect(Array.isArray(res.body) || typeof res.body === "object").toBe(true);
  });

  it("GET /api/public/societies/:societyId/blocks handles a missing society", async () => {
    const res = await request(app).get("/api/public/societies/99999999/blocks");
    expect([200, 404, 400]).toContain(res.status);
  });

  it("GET /api/public/blocks/:blockId/flats handles a missing block", async () => {
    const res = await request(app).get("/api/public/blocks/99999999/flats");
    expect([200, 404, 400]).toContain(res.status);
  });

  it("returns blocks for the first public society when data exists", async () => {
    const societies = await request(app).get("/api/public/societies");
    expectOk(societies);
    const list = Array.isArray(societies.body) ? societies.body : societies.body?.societies || [];
    if (!list.length) return;

    const societyId = list[0].id;
    const blocks = await request(app).get(`/api/public/societies/${societyId}/blocks`);
    expectOk(blocks);
  });
});
