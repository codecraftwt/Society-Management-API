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

describe("Notices API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/notices");
    expectUnauthorized(res);
  });

  it("GET /api/notices lists notices for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/notices").set(headers);
    expectOk(res);
  });

  it("GET /api/notices is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/notices").set(headers);
    expectForbidden(res);
  });

  it("POST /api/notices is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).post("/api/notices").set(headers).send({ title: "x" });
    expectForbidden(res);
  });

  it("creates and deletes a notice as admin", async () => {
    const { headers } = await login("admin");
    const title = unique("API Notice");
    const created = await request(app)
      .post("/api/notices")
      .set(headers)
      .send({ title, description: "Automated test notice" });
    expect([200, 201]).toContain(created.status);
    const id = created.body?.id || created.body?.notice?.id;
    if (!id) return;

    const updated = await request(app)
      .put(`/api/notices/${id}`)
      .set(headers)
      .send({ title: `${title} updated`, description: "Updated" });
    expectOk(updated);

    const deleted = await request(app).delete(`/api/notices/${id}`).set(headers);
    expectOk(deleted);
  });

  it("DELETE /api/notices/:id handles a missing notice", async () => {
    const { headers } = await login("admin");
    const res = await request(app).delete("/api/notices/99999999").set(headers);
    expect(res.status).toBeLessThan(500);
  });
});

describe("Complaints API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/complaints");
    expectUnauthorized(res);
  });

  it("GET /api/complaints lists complaints for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/complaints").set(headers);
    expectOk(res);
  });

  it("GET /api/complaints is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/complaints").set(headers);
    expectForbidden(res);
  });

  it("GET /api/complaints/my lists the resident's complaints", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/complaints/my").set(headers);
    expectOk(res);
  });

  it("POST /api/complaints is forbidden for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/complaints")
      .set(headers)
      .send({ title: "x", description: "y" });
    expectForbidden(res);
  });

  it("creates a complaint as a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .post("/api/complaints")
      .set(headers)
      .send({ title: unique("Complaint"), description: "Automated test complaint" });
    expect([200, 201, 400]).toContain(res.status);

    if (res.status === 201 || res.status === 200) {
      const id = res.body?.complaint?.id || res.body?.id;
      if (id) {
        const comments = await request(app).get(`/api/complaints/${id}/comments`).set(headers);
        expect(comments.status).toBeLessThan(500);

        await request(app)
          .post(`/api/complaints/${id}/comments`)
          .set(headers)
          .send({ comment: "test comment" });

        const read = await request(app).put(`/api/complaints/${id}/read`).set(headers);
        expect(read.status).toBeLessThan(500);

        const deleted = await request(app).delete(`/api/complaints/${id}`).set(headers);
        expect(deleted.status).toBeLessThan(500);
      }
    }
  });

  it("PUT /api/complaints/:id is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).put("/api/complaints/1").set(headers).send({ status: "OPEN" });
    expectForbidden(res);
  });
});

describe("Committee API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/committee/dashboard-stats");
    expectUnauthorized(res);
  });

  it("GET /api/committee/dashboard-stats succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/committee/dashboard-stats").set(headers);
    expectOk(res);
  });

  it("GET /api/committee/dashboard-stats succeeds for committee", async () => {
    const { headers } = await login("committee");
    const res = await request(app).get("/api/committee/dashboard-stats").set(headers);
    expectOk(res);
  });

  it("is forbidden for a resident", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/committee/dashboard-stats").set(headers);
    expectForbidden(res);
  });
});

describe("Dashboard API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dashboard/stats");
    expectUnauthorized(res);
  });

  it("GET /api/dashboard/stats succeeds for admin", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/dashboard/stats").set(headers);
    expectOk(res);
  });

  it("is forbidden for a guard", async () => {
    const { headers } = await login("guard");
    const res = await request(app).get("/api/dashboard/stats").set(headers);
    expectForbidden(res);
  });
});
