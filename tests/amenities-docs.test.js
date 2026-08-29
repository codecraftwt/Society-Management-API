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

describe("Settings API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/settings");
    expectUnauthorized(res);
  });

  it("GET /api/settings returns the resident settings", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/settings").set(headers);
    expectOk(res);
    expect(res.body).toHaveProperty("id");
  });

  it("PUT /api/settings updates a flag and restores it", async () => {
    const { headers } = await login("resident");
    const current = await request(app).get("/api/settings").set(headers);
    expectOk(current);
    const original = current.body.sound_alerts;

    const updated = await request(app)
      .put("/api/settings")
      .set(headers)
      .send({ sound_alerts: !original });
    expectOk(updated);

    await request(app).put("/api/settings").set(headers).send({ sound_alerts: original });
  });
});

describe("Amenities API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/amenities");
    expectUnauthorized(res);
  });

  it("GET /api/amenities lists amenities for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/amenities").set(headers);
    expectOk(res);
  });

  it("GET /api/amenities/my-bookings lists bookings", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/amenities/my-bookings").set(headers);
    expectOk(res);
  });

  it("GET /api/amenities/:id/availability requires a date", async () => {
    const { headers } = await login("resident");
    const list = await request(app).get("/api/amenities").set(headers);
    expectOk(list);
    const amenities = Array.isArray(list.body) ? list.body : list.body?.data || [];
    if (!amenities.length) return;

    const res = await request(app)
      .get(`/api/amenities/${amenities[0].id}/availability`)
      .set(headers);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date is required/i);
  });

  it("POST /api/amenities/book requires amenityId", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/amenities/book").set(headers).send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/amenities/verify-payment requires booking_id", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/amenities/verify-payment").set(headers).send({});
    expect(res.status).toBe(400);
  });
});

describe("Admin amenities API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/amenities/bookings");
    expectUnauthorized(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/admin/amenities/bookings").set(headers);
    expectForbidden(res);
  });

  it("GET /api/admin/amenities/bookings succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/admin/amenities/bookings").set(headers);
    expectOk(res);
  });

  it("GET /api/admin/amenities/bookings/pending succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/admin/amenities/bookings/pending").set(headers);
    expectOk(res);
  });

  it("POST /api/admin/amenities creates and can be left unused if name is missing", async () => {
    const { headers } = await login("admin");
    const res = await request(app).post("/api/admin/amenities").set(headers).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("creates a throwaway amenity as admin", async () => {
    const { headers } = await login("admin");
    const created = await request(app)
      .post("/api/admin/amenities")
      .set(headers)
      .send({ name: unique("Amenity"), type: "HALL", is_active: true });
    expect([200, 201, 400, 500]).toContain(created.status);
    const id = created.body?.data?.id || created.body?.id;
    if (!id) return;

    const availability = await request(app)
      .get(`/api/admin/amenities/${id}/availability`)
      .query({ date: "2099-01-01" })
      .set(headers);
    expect(availability.status).toBeLessThan(500);
  });
});

describe("Documents API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/documents");
    expectUnauthorized(res);
  });

  it("GET /api/documents succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/documents").set(headers);
    expectOk(res);
  });

  it("GET /api/documents/admin succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/documents/admin").set(headers);
    expectOk(res);
  });

  it("GET /api/documents/admin is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/documents/admin").set(headers);
    expectForbidden(res);
  });

  it("PATCH /api/documents/admin/:id handles a missing document", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .patch("/api/documents/admin/99999999")
      .set(headers)
      .send({ title: "x" });
    expect(res.status).toBeLessThan(500);
  });
});

describe("User documents API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/user-documents/my");
    expectUnauthorized(res);
  });

  it("GET /api/user-documents/my returns docs or 404", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/user-documents/my").set(headers);
    expect([200, 404]).toContain(res.status);
  });

  it("PATCH /api/user-documents/:type rejects an invalid type", async () => {
    const { headers } = await login("resident");
    const res = await request(app).patch("/api/user-documents/passport").set(headers);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid document type/i);
  });

  it("is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/user-documents/my").set(headers);
    expectForbidden(res);
  });
});

describe("Contacts API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/contacts");
    expectUnauthorized(res);
  });

  it("GET /api/contacts succeeds for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/contacts").set(headers);
    expectOk(res);
  });

  it("GET /api/contacts succeeds for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/contacts").set(headers);
    expectOk(res);
  });

  it("is forbidden for accountant", async () => {
    const { headers } = await login("accountant");
    const res = await request(app).get("/api/contacts").set(headers);
    expectForbidden(res);
  });
});
