const { getAllStat } = require("../controllers/infoControllers");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const Block = require("../models/Block");
const Flat = require("../models/Flat");
const ParkingSlot = require("../models/ParkingSlot");
const FlatMembership = require("../models/FlatMembership");

describe("Dashboard Analytics Unit Tests", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exports getAllStat function", () => {
    expect(typeof getAllStat).toBe("function");
  });

  it("handles missing societyId gracefully", async () => {
    const req = { user: {}, headers: {}, query: {} };
    let statusCode = null;
    let jsonResult = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
          },
        };
      },
      json: (data) => {
        jsonResult = data;
      },
    };

    await getAllStat(req, res);
    expect(statusCode).toBe(400);
    expect(jsonResult).toEqual({ message: "Society ID missing in token" });
  });

  it("computes occupancy and parking analytics accurately for a mixed society", async () => {
    const req = {
      user: { society_id: 101, activeRole: "SOCIETY_ADMIN" },
      headers: {},
      query: {},
    };

    jest.spyOn(User, "findAll").mockResolvedValue([
      { id: 1, email: "res1@test.com", role: "RESIDENT", roles: ["RESIDENT"] },
      { id: 2, email: "res2@test.com", role: "RESIDENT", roles: ["RESIDENT"] },
      { id: 3, email: "guard1@test.com", role: "GUARD", roles: ["GUARD"] },
    ]);

    jest.spyOn(Complaint, "count").mockResolvedValue(4);

    jest.spyOn(Block, "findAll").mockResolvedValue([
      { id: 1, property_type: "Apartments" },
      { id: 2, property_type: "Row Houses" },
      { id: 3, property_type: "Commercial" }, // Unknown / custom type
    ]);

    jest.spyOn(Flat, "findAll").mockResolvedValue([
      // Apartments (Block 1): 3 total (2 occupied, 1 vacant)
      { id: 10, block_id: 1, occupancy_status: "RENTED", resident_id: 1 },
      { id: 11, block_id: 1, occupancy_status: "OWNER_OCCUPIED", resident_id: null },
      { id: 12, block_id: 1, occupancy_status: "VACANT", resident_id: null },

      // Row Houses (Block 2): 2 total (1 occupied via membership, 1 vacant)
      { id: 20, block_id: 2, occupancy_status: "VACANT", resident_id: null },
      { id: 21, block_id: 2, occupancy_status: "VACANT", resident_id: null },

      // Other / Commercial (Block 3): 1 total (occupied)
      { id: 30, block_id: 3, occupancy_status: "RENTED", resident_id: 99 },
    ]);

    // Flat 20 has active membership
    jest.spyOn(FlatMembership, "findAll").mockResolvedValue([
      { flat_id: 20 },
    ]);

    // Parking slots: 50 total (35 assigned, 15 available)
    jest.spyOn(ParkingSlot, "count").mockImplementation(({ where }) => {
      if (where.status === "ASSIGNED") return Promise.resolve(35);
      if (where.status === "AVAILABLE") return Promise.resolve(15);
      return Promise.resolve(50);
    });

    let jsonResult = null;
    const res = {
      status: () => res,
      json: (data) => {
        jsonResult = data;
      },
    };

    await getAllStat(req, res);

    expect(jsonResult).toBeDefined();
    // Legacy metrics
    expect(jsonResult.residents).toBe(2);
    expect(jsonResult.guards).toBe(1);
    expect(jsonResult.openComplaints).toBe(4);
    expect(jsonResult.totalFlats).toBe(6);
    expect(jsonResult.occupiedFlats).toBe(4);
    expect(jsonResult.vacantFlats).toBe(2);

    // Modern occupancy metrics
    expect(jsonResult.occupancy).toEqual({
      overallRate: 67, // Math.round((4 / 6) * 100) = 67%
      totalProperties: 6,
      totalOccupied: 4,
      totalVacant: 2,
      apartments: {
        total: 3,
        occupied: 2,
        vacant: 1,
        rate: 67, // Math.round((2 / 3) * 100) = 67%
      },
      rowHouses: {
        total: 2,
        occupied: 1,
        vacant: 1,
        rate: 50, // Math.round((1 / 2) * 100) = 50%
      },
    });

    // Modern parking metrics
    expect(jsonResult.parking).toEqual({
      total: 50,
      allocated: 35,
      available: 15,
      allocationRate: 70, // Math.round((35 / 50) * 100) = 70%
    });
  });

  it("gracefully handles zero flats and zero parking slots", async () => {
    const req = {
      user: { society_id: 202, activeRole: "SOCIETY_ADMIN" },
      headers: {},
      query: {},
    };

    jest.spyOn(User, "findAll").mockResolvedValue([]);
    jest.spyOn(Complaint, "count").mockResolvedValue(0);
    jest.spyOn(Block, "findAll").mockResolvedValue([]);
    jest.spyOn(Flat, "findAll").mockResolvedValue([]);
    jest.spyOn(FlatMembership, "findAll").mockResolvedValue([]);
    jest.spyOn(ParkingSlot, "count").mockResolvedValue(0);

    let jsonResult = null;
    const res = {
      status: () => res,
      json: (data) => {
        jsonResult = data;
      },
    };

    await getAllStat(req, res);

    expect(jsonResult.occupancy).toEqual({
      overallRate: 0,
      totalProperties: 0,
      totalOccupied: 0,
      totalVacant: 0,
      apartments: { total: 0, occupied: 0, vacant: 0, rate: 0 },
      rowHouses: { total: 0, occupied: 0, vacant: 0, rate: 0 },
    });

    expect(jsonResult.parking).toEqual({
      total: 0,
      allocated: 0,
      available: 0,
      allocationRate: 0,
    });
  });
});
