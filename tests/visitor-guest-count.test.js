const request = require("supertest");
const express = require("express");

jest.mock("../models/VisitorLog", () => ({
  create: jest.fn(),
  count: jest.fn(),
  findAll: jest.fn(),
}));
jest.mock("../models/VisitorPreApproval", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../models/Flat", () => ({
  findOne: jest.fn(),
  findByPk: jest.fn(),
}));
jest.mock("../models/Block", () => ({}));
jest.mock("../models/User", () => ({}));
jest.mock("../models/FlatMembership", () => ({
  findAll: jest.fn(),
}));
jest.mock("../models/ParkingSlot", () => ({
  findOne: jest.fn(),
}));
jest.mock("../models/ParkingRequest", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../models/GuardShift", () => ({
  findOne: jest.fn(),
  findAll: jest.fn(),
}));
jest.mock("../models/Society", () => ({
  findByPk: jest.fn(),
}));
jest.mock("../utils/istTime", () => ({
  getCurrentISTDate: jest.fn().mockReturnValue("2026-11-26"),
  getCurrentISTMinutes: jest.fn().mockReturnValue(600),
}));
jest.mock("../utils/shiftTiming", () => ({
  getShiftTimings: jest.fn().mockResolvedValue({}),
  getCurrentShiftTypeFromTimings: jest.fn().mockReturnValue("DAY"),
  isTimeInShift: jest.fn().mockReturnValue(true),
}));
jest.mock("../utils/pushNotification", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock("../services/notificationService", () => ({
  send: jest.fn().mockResolvedValue(true),
  createNotification: jest.fn().mockResolvedValue(true),
  sendNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock("../utils/accessHelpers", () => ({
  getUserAuthorizedFlatIds: jest.fn().mockResolvedValue([55]),
}));
jest.mock("../utils/flatOccupancy", () => ({
  getActiveTenantForFlat: jest.fn().mockResolvedValue(null),
}));

const VisitorLog = require("../models/VisitorLog");
const VisitorPreApproval = require("../models/VisitorPreApproval");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const GuardShift = require("../models/GuardShift");
const Society = require("../models/Society");

const { addVisitor } = require("../controllers/visitorControllers");
const { verifyGatePass } = require("../controllers/preApprovalControllers");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 10, society_id: 1, role: "GUARD", name: "Guard One" };
    req.app = { get: () => null };
    next();
  });
  app.post("/api/visitors", addVisitor);
  app.post("/api/preapproval/verify", verifyGatePass);
  return app;
}

describe("Visitor & GatePass guest_count support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /api/visitors stores explicit guest_count for manual GUEST entry", async () => {
    GuardShift.findAll.mockResolvedValue([{ id: 1, shift_type: "DAY" }]);
    Flat.findOne.mockResolvedValue({ id: 55, flat_number: "101" });
    FlatMembership.findAll.mockResolvedValue([
      { user_id: 22, role: "OWNER", is_staying: true, User: { id: 22, fcm_token: null } },
    ]);
    VisitorLog.create.mockImplementation(async (data) => ({ id: 900, ...data }));

    const res = await request(createApp())
      .post("/api/visitors")
      .send({
        flat_id: 55,
        visitor_name: "Ramesh Kumar",
        mobile: "9876543210",
        purpose: "GUEST",
        guest_count: 4,
      });

    expect(res.status).toBe(201);
    expect(VisitorLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "GUEST",
        guest_count: 4,
      })
    );
    expect(res.body.visitor.guest_count).toBe(4);
  });

  test("POST /api/visitors rejects invalid guest_count (< 1 or non-integer)", async () => {
    const res = await request(createApp())
      .post("/api/visitors")
      .send({
        flat_id: 55,
        visitor_name: "Ramesh Kumar",
        mobile: "9876543210",
        purpose: "GUEST",
        guest_count: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/whole number/i);
    expect(VisitorLog.create).not.toHaveBeenCalled();
  });

  test("POST /api/preapproval/verify stores guest_count on SINGLE gate pass scan", async () => {
    GuardShift.findOne.mockResolvedValue({ id: 1, shift_type: "DAY" });
    Society.findByPk.mockResolvedValue({ id: 1, name: "Test Society" });
    const mockApproval = {
      id: 77,
      otp: "GP-123456",
      visitor_name: "Priya Guest",
      purpose: "GUEST",
      flat_id: 55,
      resident_id: 22,
      mobile: "9876543210",
      vehicle_number: null,
      pass_type: "SINGLE",
      status: "PENDING",
      dwell_minutes: 60,
      save: jest.fn().mockResolvedValue(true),
    };
    VisitorPreApproval.findOne.mockResolvedValue(mockApproval);
    Flat.findByPk.mockResolvedValue({ id: 55, resident_id: 22 });
    VisitorLog.create.mockImplementation(async (data) => ({
      id: 901,
      entry_time: new Date().toISOString(),
      ...data,
    }));

    const res = await request(createApp())
      .post("/api/preapproval/verify")
      .send({
        code: "GP-123456",
        guest_count: 3,
      });

    expect(res.status).toBe(200);
    expect(VisitorLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        preapproval_id: 77,
        guest_count: 3,
      })
    );
    expect(res.body.visitor.guest_count).toBe(3);
  });

  test("POST /api/preapproval/verify rejects invalid guest_count on gate pass scan", async () => {
    GuardShift.findOne.mockResolvedValue({ id: 1, shift_type: "DAY" });
    VisitorPreApproval.findOne.mockResolvedValue({
      id: 77,
      otp: "GP-123456",
      visitor_name: "Priya Guest",
      purpose: "GUEST",
      flat_id: 55,
      resident_id: 22,
      mobile: "9876543210",
      vehicle_number: null,
      pass_type: "SINGLE",
      status: "PENDING",
    });
    Flat.findByPk.mockResolvedValue({ id: 55, resident_id: 22 });

    const res = await request(createApp())
      .post("/api/preapproval/verify")
      .send({
        code: "GP-123456",
        guest_count: -2,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/whole number/i);
    expect(VisitorLog.create).not.toHaveBeenCalled();
  });
});
