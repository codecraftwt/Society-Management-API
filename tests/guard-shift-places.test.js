const GuardShift = require("../models/GuardShift");
const GuardShiftPlace = require("../models/GuardShiftPlace");

jest.mock("../utils/shiftTiming", () => ({
  SHIFT_TYPES: ["MORNING", "AFTERNOON", "NIGHT"],
  getShiftTimings: jest.fn().mockResolvedValue({}),
  validateTimingsConfig: jest.fn((v) => v),
}));

const {
  upsertShift,
  updateShift,
  listShiftPlaces,
  createShiftPlace,
  updateShiftPlace,
  deleteShiftPlace,
} = require("../controllers/guardShiftControllers");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
}

describe("Guard Shift Places & Shift Place Assignment", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("listShiftPlaces filters by user's society and optional activeOnly", async () => {
    const spy = jest.spyOn(GuardShiftPlace, "findAll").mockResolvedValue([
      { id: 1, society_id: 5, name: "Main Gate", is_active: true },
    ]);
    const req = {
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      query: { activeOnly: "true" },
    };
    const res = makeRes();

    await listShiftPlaces(req, res);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { society_id: 5, is_active: true },
      })
    );
    expect(res.body.success).toBe(true);
    expect(res.body.places).toHaveLength(1);
  });

  test("createShiftPlace validates name, prevents duplicate, and creates place", async () => {
    jest.spyOn(GuardShiftPlace, "findOne").mockResolvedValue(null);
    const createSpy = jest.spyOn(GuardShiftPlace, "create").mockResolvedValue({
      id: 10,
      society_id: 5,
      name: "East Gate",
      description: "Near Block C",
      is_active: true,
    });

    const req = {
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      body: { name: "  East Gate  ", description: "Near Block C" },
    };
    const res = makeRes();

    await createShiftPlace(req, res);

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledWith({
      society_id: 5,
      name: "East Gate",
      description: "Near Block C",
      is_active: true,
    });
    expect(res.body.place.name).toBe("East Gate");
  });

  test("createShiftPlace rejects duplicate name with 409", async () => {
    jest.spyOn(GuardShiftPlace, "findOne").mockResolvedValue({ id: 2, name: "Main Gate" });
    const createSpy = jest.spyOn(GuardShiftPlace, "create");
    const req = {
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      body: { name: "Main Gate" },
    };
    const res = makeRes();

    await createShiftPlace(req, res);

    expect(res.statusCode).toBe(409);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("updateShiftPlace updates name, description and is_active", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    jest.spyOn(GuardShiftPlace, "findByPk").mockResolvedValue({
      id: 10,
      society_id: 5,
      name: "East Gate",
      description: null,
      is_active: true,
      update: updateMock,
    });
    jest.spyOn(GuardShiftPlace, "findOne").mockResolvedValue(null);

    const req = {
      params: { id: "10" },
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      body: { name: "East Gate B", description: "Entry", is_active: false },
    };
    const res = makeRes();

    await updateShiftPlace(req, res);

    expect(updateMock).toHaveBeenCalledWith({
      name: "East Gate B",
      description: "Entry",
      is_active: false,
    });
    expect(res.body.success).toBe(true);
  });

  test("deleteShiftPlace deletes place belonging to admin's society", async () => {
    const destroyMock = jest.fn().mockResolvedValue(true);
    jest.spyOn(GuardShiftPlace, "findByPk").mockResolvedValue({
      id: 10,
      society_id: 5,
      destroy: destroyMock,
    });

    const req = {
      params: { id: "10" },
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
    };
    const res = makeRes();

    await deleteShiftPlace(req, res);

    expect(destroyMock).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
  });

  test("upsertShift validates shift_place_id and saves it with shift", async () => {
    jest.spyOn(GuardShift, "findAll").mockResolvedValue([]);
    jest.spyOn(GuardShiftPlace, "findOne").mockResolvedValue({ id: 3, society_id: 5, name: "Main Gate" });
    const createSpy = jest.spyOn(GuardShift, "create").mockResolvedValue({ id: 99 });
    jest.spyOn(GuardShift, "findByPk").mockResolvedValue({
      id: 99,
      guard_id: 7,
      society_id: 5,
      shift_type: "MORNING",
      shift_place_id: 3,
      shiftPlace: { id: 3, name: "Main Gate" },
    });

    const req = {
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      body: {
        guard_id: 7,
        shift_type: "MORNING",
        shift_place_id: 3,
        start_date: "2026-11-26",
        end_date: "2026-11-30",
      },
    };
    const res = makeRes();

    await upsertShift(req, res);

    expect(createSpy).toHaveBeenCalledWith({
      guard_id: 7,
      society_id: 5,
      shift_type: "MORNING",
      shift_place_id: 3,
      start_date: "2026-11-26",
      end_date: "2026-11-30",
    });
    expect(res.body.shiftPlace.name).toBe("Main Gate");
  });

  test("updateShift rejects shift_place_id from another society", async () => {
    jest.spyOn(GuardShift, "findByPk").mockResolvedValue({
      id: 99,
      guard_id: 7,
      society_id: 5,
      shift_type: "MORNING",
      shift_place_id: null,
      start_date: "2026-11-26",
      end_date: "2026-11-30",
    });
    jest.spyOn(GuardShiftPlace, "findOne").mockResolvedValue(null);

    const req = {
      params: { id: "99" },
      user: { role: "SOCIETY_ADMIN", society_id: 5 },
      body: { shift_place_id: 999 },
    };
    const res = makeRes();

    await updateShift(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/not found for this society/i);
  });
});
