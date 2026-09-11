const {
  request,
  app,
  login,
  expectUnauthorized,
  expectOk,
} = require("./helpers/api");

describe("Accountant Module Integration Tests", () => {
  it("rejects unauthenticated access to eligible residents", async () => {
    const res = await request(app).get("/api/accountant/eligible-residents");
    expectUnauthorized(res);
  });

  it("GET /api/accountant/eligible-residents succeeds for society admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/accountant/eligible-residents").set(headers);
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/accountant succeeds for society admin and returns list", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/accountant").set(headers);
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
