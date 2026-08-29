const { request, app } = require("./helpers/api");

describe("Health", () => {
  it("GET / returns API running message", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/API is running/i);
  });

  it("GET unknown API path returns 404", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist");
    expect(res.status).toBe(404);
  });
});
