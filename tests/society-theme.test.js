const {
  request,
  app,
  login,
  expectUnauthorized,
  expectForbidden,
  expectOk,
  expectClientError,
} = require("./helpers/api");

describe("Society Theme Customization API", () => {
  it("requires authentication for theme endpoints", async () => {
    const res = await request(app).get("/api/societies/1/theme");
    expectUnauthorized(res);
  });

  it("GET /api/societies/:id/theme returns theme for authorized admin", async () => {
    const { headers, user } = await login("admin");
    const societyId = user.society_id;
    const res = await request(app).get(`/api/societies/${societyId}/theme`).set(headers);
    expectOk(res);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("society_id", societyId);
    expect(res.body).toHaveProperty("theme");
  });

  it("GET /api/societies/:id/theme is accessible by Super Admin for any society", async () => {
    const { headers } = await login("superAdmin");
    const res = await request(app).get("/api/societies/1/theme").set(headers);
    expectOk(res);
    expect(res.body).toHaveProperty("success", true);
  });

  it("GET /api/societies/:id/theme is forbidden when Society Admin accesses another society", async () => {
    const { headers, user } = await login("admin");
    const otherSocietyId = (user.society_id || 1) + 9999;
    const res = await request(app).get(`/api/societies/${otherSocietyId}/theme`).set(headers);
    expectForbidden(res);
  });

  it("PUT /api/societies/:id/theme validates valid HEX colors and updates theme", async () => {
    const { headers, user } = await login("admin");
    const societyId = user.society_id;
    const res = await request(app)
      .put(`/api/societies/${societyId}/theme`)
      .set(headers)
      .send({ primary_color: "#10b981", accent_color: "#059669" });

    expectOk(res);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.theme.primary).toBe("#10b981");
    expect(res.body.theme.accent).toBe("#059669");
  });

  it("PUT /api/societies/:id/theme rejects invalid HEX colors", async () => {
    const { headers, user } = await login("admin");
    const societyId = user.society_id;

    // Test invalid color string
    const res1 = await request(app)
      .put(`/api/societies/${societyId}/theme`)
      .set(headers)
      .send({ primary_color: "javascript:alert(1)" });
    expectClientError(res1);

    // Test rgb string
    const res2 = await request(app)
      .put(`/api/societies/${societyId}/theme`)
      .set(headers)
      .send({ primary_color: "rgb(255,0,0)" });
    expectClientError(res2);
  });

  it("PUT /api/societies/:id/theme is forbidden for residents", async () => {
    const { headers, user } = await login("resident");
    const societyId = user.society_id || 1;
    const res = await request(app)
      .put(`/api/societies/${societyId}/theme`)
      .set(headers)
      .send({ primary_color: "#6366f1" });
    expectForbidden(res);
  });

  it("PUT /api/societies/:id/theme rejects cross-society mutation by Society Admin", async () => {
    const { headers, user } = await login("admin");
    const otherSocietyId = (user.society_id || 1) + 9999;
    const res = await request(app)
      .put(`/api/societies/${otherSocietyId}/theme`)
      .set(headers)
      .send({ primary_color: "#6366f1" });
    expectForbidden(res);
  });

  it("POST /api/societies/:id/theme/reset resets theme to default", async () => {
    const { headers, user } = await login("admin");
    const societyId = user.society_id;

    const res = await request(app)
      .post(`/api/societies/${societyId}/theme/reset`)
      .set(headers);
    expectOk(res);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.theme.primary).toBeNull();
    expect(res.body.theme.accent).toBeNull();
  });

  describe("Society Logo Management", () => {
    const ONE_PIXEL_PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    it("GET /api/societies/:id/theme includes logo_url field", async () => {
      const { headers, user } = await login("admin");
      const res = await request(app).get(`/api/societies/${user.society_id}/theme`).set(headers);
      expectOk(res);
      expect(res.body).toHaveProperty("logo_url");
      expect(res.body.theme).toHaveProperty("logo_url");
    });

    it("POST /api/societies/:id/logo requires authentication", async () => {
      const res = await request(app)
        .post("/api/societies/1/logo")
        .attach("logo", ONE_PIXEL_PNG, { filename: "logo.png", contentType: "image/png" });
      expectUnauthorized(res);
    });

    it("DELETE /api/societies/:id/logo requires authentication", async () => {
      const res = await request(app).delete("/api/societies/1/logo");
      expectUnauthorized(res);
    });

    it("POST /api/societies/:id/logo is forbidden for non-admin roles (resident)", async () => {
      const { headers, user } = await login("resident");
      const res = await request(app)
        .post(`/api/societies/${user.society_id || 1}/logo`)
        .set(headers)
        .attach("logo", ONE_PIXEL_PNG, { filename: "logo.png", contentType: "image/png" });
      expectForbidden(res);
    });

    it("DELETE /api/societies/:id/logo is forbidden for non-admin roles (resident)", async () => {
      const { headers, user } = await login("resident");
      const res = await request(app)
        .delete(`/api/societies/${user.society_id || 1}/logo`)
        .set(headers);
      expectForbidden(res);
    });

    it("POST /api/societies/:id/logo prevents cross-society upload by Society Admin", async () => {
      const { headers, user } = await login("admin");
      const otherSocietyId = (user.society_id || 1) + 9999;
      const res = await request(app)
        .post(`/api/societies/${otherSocietyId}/logo`)
        .set(headers)
        .attach("logo", ONE_PIXEL_PNG, { filename: "logo.png", contentType: "image/png" });
      expectForbidden(res);
    });

    it("DELETE /api/societies/:id/logo prevents cross-society deletion by Society Admin", async () => {
      const { headers, user } = await login("admin");
      const otherSocietyId = (user.society_id || 1) + 9999;
      const res = await request(app)
        .delete(`/api/societies/${otherSocietyId}/logo`)
        .set(headers);
      expectForbidden(res);
    });

    it("POST /api/societies/:id/logo rejects missing file", async () => {
      const { headers, user } = await login("admin");
      const res = await request(app)
        .post(`/api/societies/${user.society_id}/logo`)
        .set(headers);
      expectClientError(res);
    });

    it("POST /api/societies/:id/logo rejects non-image formats (PDF, executable)", async () => {
      const { headers, user } = await login("admin");
      const res = await request(app)
        .post(`/api/societies/${user.society_id}/logo`)
        .set(headers)
        .attach("logo", Buffer.from("%PDF-1.4 mock pdf"), { filename: "logo.pdf", contentType: "application/pdf" });
      expectClientError(res);
    });

    it("POST /api/societies/:id/logo rejects oversized files (> 5MB)", async () => {
      const { headers, user } = await login("admin");
      const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
      const res = await request(app)
        .post(`/api/societies/${user.society_id}/logo`)
        .set(headers)
        .attach("logo", oversized, { filename: "huge.png", contentType: "image/png" });
      expectClientError(res);
    });

    it("DELETE /api/societies/:id/logo succeeds for authorized society admin", async () => {
      const { headers, user } = await login("admin");
      const res = await request(app)
        .delete(`/api/societies/${user.society_id}/logo`)
        .set(headers);
      expectOk(res);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.logo_url).toBeNull();
    });

    it("DELETE /api/societies/:id/logo succeeds for Super Admin across societies", async () => {
      const { headers } = await login("superAdmin");
      const res = await request(app)
        .delete("/api/societies/1/logo")
        .set(headers);
      expectOk(res);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.logo_url).toBeNull();
    });
  });
});
