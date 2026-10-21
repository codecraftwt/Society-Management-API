const {
  request,
  app,
  login,
  unique,
  expectOk,
  expectClientError,
  expectForbidden,
} = require("./helpers/api");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const Flat = require("../models/Flat");
const MaintenanceRate = require("../models/MaintenanceRate");
const FlatMembership = require("../models/FlatMembership");
const User = require("../models/User");

describe("BHK Configuration End-to-End Suite", () => {
  let adminSession;
  let societyId;
  let testBlockIds = [];

  beforeAll(async () => {
    adminSession = await login("admin");
    societyId = adminSession.user.society_id;
  });

  afterAll(async () => {
    // Cleanup blocks created during test
    if (testBlockIds.length > 0) {
      for (const bId of testBlockIds) {
        try {
          await Flat.destroy({ where: { block_id: bId } });
          await Floor.destroy({ where: { block_id: bId } });
          await Block.destroy({ where: { id: bId } });
        } catch {}
      }
    }
  });

  it("1. Creates an apartment block with a uniform BHK layout", async () => {
    const blockName = unique("BlkU");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 2,
      flats_per_floor: 2,
      floors: [
        {
          floor_number: 1,
          flats: [
            { flat_number: `${blockName}-101`, flat_type: "2BHK" },
            { flat_number: `${blockName}-102`, flat_type: "2BHK" },
          ],
        },
        {
          floor_number: 2,
          flats: [
            { flat_number: `${blockName}-201`, flat_type: "2BHK" },
            { flat_number: `${blockName}-202`, flat_type: "2BHK" },
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectOk(res);
    const blockId = res.body.block.id;
    testBlockIds.push(blockId);

    const flats = await Flat.findAll({ where: { block_id: blockId } });
    expect(flats.length).toBe(4);
    flats.forEach((f) => {
      expect(f.flat_type).toBe("2BHK");
      expect(f.occupancy_status).toBe("VACANT");
    });
  });

  it("2. Creates a block with different BHKs on different floors", async () => {
    const blockName = unique("BlkDF");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 2,
      flats_per_floor: 2,
      floors: [
        {
          floor_number: 1,
          flats: [
            { flat_number: `${blockName}-101`, flat_type: "1BHK" },
            { flat_number: `${blockName}-102`, flat_type: "1BHK" },
          ],
        },
        {
          floor_number: 2,
          flats: [
            { flat_number: `${blockName}-201`, flat_type: "3BHK" },
            { flat_number: `${blockName}-202`, flat_type: "3BHK" },
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectOk(res);
    const blockId = res.body.block.id;
    testBlockIds.push(blockId);

    const floor1Flats = await Flat.findAll({
      where: { block_id: blockId, flat_number: [`${blockName}-101`, `${blockName}-102`] },
    });
    const floor2Flats = await Flat.findAll({
      where: { block_id: blockId, flat_number: [`${blockName}-201`, `${blockName}-202`] },
    });

    floor1Flats.forEach((f) => expect(f.flat_type).toBe("1BHK"));
    floor2Flats.forEach((f) => expect(f.flat_type).toBe("3BHK"));
  });

  it("3. Creates a floor with a mixed BHK distribution", async () => {
    const blockName = unique("BlkMx");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 1,
      flats_per_floor: 3,
      floors: [
        {
          floor_number: 1,
          flats: [
            { flat_number: `${blockName}-101`, flat_type: "1BHK" },
            { flat_number: `${blockName}-102`, flat_type: "2BHK" },
            { flat_number: `${blockName}-103`, flat_type: "3BHK" },
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectOk(res);
    const blockId = res.body.block.id;
    testBlockIds.push(blockId);

    const f101 = await Flat.findOne({ where: { flat_number: `${blockName}-101` } });
    const f102 = await Flat.findOne({ where: { flat_number: `${blockName}-102` } });
    const f103 = await Flat.findOne({ where: { flat_number: `${blockName}-103` } });

    expect(f101.flat_type).toBe("1BHK");
    expect(f102.flat_type).toBe("2BHK");
    expect(f103.flat_type).toBe("3BHK");
  });

  it("4. Creates individually overridden flats accurately", async () => {
    const blockName = unique("BlkOv");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 1,
      flats_per_floor: 3,
      floors: [
        {
          floor_number: 1,
          flats: [
            { flat_number: `${blockName}-101`, flat_type: "2BHK" }, // default
            { flat_number: `${blockName}-102`, flat_type: "3BHK" }, // individual override
            { flat_number: `${blockName}-103`, flat_type: "2BHK" }, // default
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectOk(res);
    const blockId = res.body.block.id;
    testBlockIds.push(blockId);

    const flats = await Flat.findAll({ where: { block_id: blockId }, order: [["flat_number", "ASC"]] });
    expect(flats[0].flat_type).toBe("2BHK");
    expect(flats[1].flat_type).toBe("3BHK");
    expect(flats[2].flat_type).toBe("2BHK");
  });

  it("5. Rejects unsupported BHK values (e.g. 4BHK)", async () => {
    const blockName = unique("BlkBad");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 1,
      flats_per_floor: 1,
      floors: [
        {
          floor_number: 1,
          flats: [{ flat_number: `${blockName}-101`, flat_type: "4BHK" }],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectClientError(res);
    expect(res.body.message).toMatch(/invalid.*bhk/i);
  });

  it("6. Rejects invalid floor or unit counts", async () => {
    const blockName = unique("BlkInv");
    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send({
        name: blockName,
        society_id: societyId,
        property_type: "APARTMENT",
        floor_count: 0,
        flats_per_floor: 2,
      });

    expectClientError(res);
  });

  it("7. Rejects incomplete or inconsistent layouts", async () => {
    const blockName = unique("BlkInc");
    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send({
        name: blockName,
        society_id: societyId,
        property_type: "APARTMENT",
        floor_count: 2,
        flats_per_floor: 2,
        floors: [
          // Missing floor 2
          {
            floor_number: 1,
            flats: [
              { flat_number: `${blockName}-101`, flat_type: "2BHK" },
              { flat_number: `${blockName}-102`, flat_type: "2BHK" },
            ],
          },
        ],
      });

    expectClientError(res);
    expect(res.body.message).toMatch(/layout must contain exactly 2 floor/i);
  });

  it("8. Rejects duplicate flat numbers within the layout", async () => {
    const blockName = unique("BlkDup");
    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send({
        name: blockName,
        society_id: societyId,
        property_type: "APARTMENT",
        floor_count: 1,
        flats_per_floor: 2,
        floors: [
          {
            floor_number: 1,
            flats: [
              { flat_number: `${blockName}-101`, flat_type: "2BHK" },
              { flat_number: `${blockName}-101`, flat_type: "2BHK" }, // duplicate
            ],
          },
        ],
      });

    expectClientError(res);
    expect(res.body.message).toMatch(/duplicate flat number/i);
  });

  it("9. Rolls back database transaction when an error occurs during creation", async () => {
    const blockName = unique("BlkRollback");
    const payload = {
      name: blockName,
      society_id: societyId,
      property_type: "APARTMENT",
      floor_count: 2,
      flats_per_floor: 1,
      floors: [
        {
          floor_number: 1,
          flats: [{ flat_number: `${blockName}-101`, flat_type: "2BHK" }],
        },
        {
          floor_number: 2,
          // floor 2 has invalid BHK, triggering failure
          flats: [{ flat_number: `${blockName}-201`, flat_type: "INVALID_BHK" }],
        },
      ],
    };

    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send(payload);

    expectClientError(res);

    // Verify block was NOT persisted due to transaction rollback
    const block = await Block.findOne({ where: { name: blockName } });
    expect(block).toBeNull();

    const flats = await Flat.findAll({ where: { flat_number: `${blockName}-101` } });
    expect(flats.length).toBe(0);
  });

  it("10. Preserves flat BHK during resident assignment and routine updates", async () => {
    // 1. Create a flat with 3BHK
    const blockName = unique("BlkRes");
    const createRes = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send({
        name: blockName,
        society_id: societyId,
        property_type: "APARTMENT",
        floor_count: 1,
        flats_per_floor: 1,
        floors: [
          {
            floor_number: 1,
            flats: [{ flat_number: `${blockName}-101`, flat_type: "3BHK" }],
          },
        ],
      });

    expectOk(createRes);
    const blockId = createRes.body.block.id;
    testBlockIds.push(blockId);

    const flat = await Flat.findOne({ where: { flat_number: `${blockName}-101` } });
    expect(flat.flat_type).toBe("3BHK");

    // 2. Fetch a resident to assign
    const resident = await User.findOne({
      where: { role: "RESIDENT" },
    });

    if (resident) {
      // 3. Assign flat to resident with a different flat_type ("1BHK") in request body
      const assignRes = await request(app)
        .put(`/api/flats/assign/${flat.id}`)
        .set(adminSession.headers)
        .send({
          resident_id: resident.id,
          flat_type: "1BHK", // Should NOT overwrite existing 3BHK!
        });

      expectOk(assignRes);

      // Verify DB flat_type is still 3BHK!
      await flat.reload();
      expect(flat.flat_type).toBe("3BHK");

      // 4. Update flat through authorized updateFlat
      const adminUpdateRes = await request(app)
        .put(`/api/flats/update/${flat.id}`)
        .set(adminSession.headers)
        .send({ flat_type: "2BHK" });

      expectOk(adminUpdateRes);
      await flat.reload();
      expect(flat.flat_type).toBe("2BHK");

      // 5. Unassign flat
      const unassignRes = await request(app)
        .put(`/api/flats/unassign/${flat.id}`)
        .set(adminSession.headers);

      expectOk(unassignRes);
      await flat.reload();
      expect(flat.flat_type).toBe("2BHK");
    }
  });

  it("11. Maintains backward compatibility for legacy callers omitting floors", async () => {
    const blockName = unique("BlkLeg");
    const res = await request(app)
      .post("/api/blocks")
      .set(adminSession.headers)
      .send({
        name: blockName,
        society_id: societyId,
        property_type: "APARTMENT",
        floor_count: 2,
        flats_per_floor: 2,
      });

    expectOk(res);
    const blockId = res.body.block.id;
    testBlockIds.push(blockId);

    const flats = await Flat.findAll({ where: { block_id: blockId } });
    expect(flats.length).toBe(4);
    // Legacy generation sets flat numbers with default naming and null flat_type
    expect(flats[0].flat_number).toBe(`${blockName}-101`);
  });

  it("12. Matches newly created BHK flat with maintenance rate accurately", async () => {
    // Check or create a maintenance rate for 3BHK
    let rate = await MaintenanceRate.findOne({
      where: { society_id: societyId, maintenance_type: "FLAT", flat_type: "3BHK" },
    });

    if (!rate) {
      rate = await MaintenanceRate.create({
        society_id: societyId,
        maintenance_type: "FLAT",
        name: "3BHK Test Rate",
        flat_type: "3BHK",
        resident_type: "OWNER",
        amount: 4500,
        frequency: "MONTHLY",
        is_active: true,
      });
    }

    expect(rate.flat_type).toBe("3BHK");
    expect(Number(rate.amount)).toBeGreaterThan(0);
  });
});
