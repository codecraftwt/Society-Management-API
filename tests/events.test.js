const request = require("supertest");
const app = require("../app");
const jwt = require("jsonwebtoken");
const { ALL_MODULE_ACTIONS } = require("../controllers/permissionController");

describe("Event Management API Tests", () => {
  let token;

  beforeAll(() => {
    token = jwt.sign(
      { id: 1, email: "admin@test.com", role: "SOCIETY_ADMIN", society_id: 1 },
      process.env.JWT_SECRET || "supersecretkey123"
    );
  });

  describe("Model Export Verification", () => {
    it("should export Event and EventMedia models from models/index.js", () => {
      const { Event, EventMedia } = require("../models");
      expect(Event).toBeDefined();
      expect(typeof Event.create).toBe("function");
      expect(EventMedia).toBeDefined();
      expect(typeof EventMedia.create).toBe("function");
    });
  });

  describe("Permission Catalog Registration", () => {
    it("should include 'events' in ALL_MODULE_ACTIONS catalog", () => {
      expect(ALL_MODULE_ACTIONS).toHaveProperty("events");
      expect(ALL_MODULE_ACTIONS.events).toEqual(["view", "create", "edit", "delete"]);
    });

    it("should include 'events' in GET /api/permissions/modules catalog for authenticated users", async () => {
      const res = await request(app)
        .get("/api/permissions/modules")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.modules).toHaveProperty("events");
      expect(res.body.modules.events).toEqual(["view", "create", "edit", "delete"]);
    });
  });

  describe("Authentication & Security Controls", () => {
    it("should reject anonymous GET /api/events with 401", async () => {
      const res = await request(app).get("/api/events");
      expect(res.status).toBe(401);
    });

    it("should reject anonymous GET /api/events/admin with 401", async () => {
      const res = await request(app).get("/api/events/admin");
      expect(res.status).toBe(401);
    });

    it("should reject anonymous POST /api/events with 401", async () => {
      const res = await request(app).post("/api/events").send({ title: "Test Event" });
      expect(res.status).toBe(401);
    });

    it("should reject anonymous PUT /api/events/1 with 401", async () => {
      const res = await request(app).put("/api/events/1").send({ title: "Test Event" });
      expect(res.status).toBe(401);
    });

    it("should reject anonymous DELETE /api/events/1 with 401", async () => {
      const res = await request(app).delete("/api/events/1");
      expect(res.status).toBe(401);
    });
  });
});
