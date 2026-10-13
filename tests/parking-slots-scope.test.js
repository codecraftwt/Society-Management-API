const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
} = require("./helpers/api");

describe("Parking Slots society-scope isolation", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/parking-slots/available");
    expectUnauthorized(res);
  });

  it("admin cannot widen available slots scope with a foreign x-society-id header", async () => {
    const { headers } = await login("admin");
    const base = await request(app).get("/api/parking-slots/available").set(headers);
    const widened = await request(app)
      .get("/api/parking-slots/available")
      .set({ ...headers, "x-society-id": "999999" });

    if (base.status === 200) {
      expect(widened.status).toBe(200);
      expect(Array.isArray(widened.body)).toBe(true);
      expect(widened.body.length).toBe(base.body.length);
    } else {
      expect([200, 500]).toContain(widened.status);
    }
  });

  it("admin cannot widen available slots scope with ?society_id query param", async () => {
    const { headers } = await login("admin");
    const base = await request(app).get("/api/parking-slots/available").set(headers);
    const foreign = await request(app)
      .get("/api/parking-slots/available?society_id=999999")
      .set(headers);

    if (base.status === 200) {
      expect(foreign.status).toBe(200);
      expect(Array.isArray(foreign.body)).toBe(true);
      expect(foreign.body.length).toBe(base.body.length);
    } else {
      expect([200, 500]).toContain(foreign.status);
    }
  });

  it("resident is forbidden from creating parking slots", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .post("/api/parking-slots")
      .set(headers)
      .send({ prefix: "P", start_number: 1, count: 1, vehicle_type: "CAR" });
    expectForbidden(res);
  });
});
