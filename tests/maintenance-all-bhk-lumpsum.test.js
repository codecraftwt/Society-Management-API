const {
  request,
  app,
  login,
  unique,
  expectOk,
  expectClientError,
} = require("./helpers/api");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const Flat = require("../models/Flat");
const MaintenanceRate = require("../models/MaintenanceRate");
const FlatMembership = require("../models/FlatMembership");
const User = require("../models/User");
const Bill = require("../models/Bill");
const sequelize = require("../config/db");

describe("Maintenance Configuration Enhancement: All BHK + Lumpsum Suite", () => {
  let adminSession;
  let societyId;
  let testBlockIds = [];
  let testFlatIds = [];
  let testRateIds = [];
  let testOwnerUser;

  beforeAll(async () => {
    try {
      await sequelize.query("ALTER TABLE MaintenanceRates MODIFY COLUMN flat_type VARCHAR(50) NULL");
    } catch {}

    adminSession = await login("admin");
    societyId = adminSession.user.society_id;

    // Create a dedicated test owner user
    testOwnerUser = await User.create({
      name: "Test Maintenance Owner",
      email: unique("maint_owner") + "@test.com",
      phone: "98765" + Math.floor(10000 + Math.random() * 90000),
      password: "hashedpassword123",
      role: "RESIDENT",
      society_id: societyId,
      status: "ACTIVE",
      approval_status: "APPROVED",
    });

    // Create an Apartment Block with 1BHK, 2BHK, 3BHK flats
    const aptBlockName = unique("BlkApt");
    const aptBlock = await Block.create({
      name: aptBlockName,
      society_id: societyId,
      property_type: "APARTMENT",
    });
    testBlockIds.push(aptBlock.id);

    const f1 = await Flat.create({
      flat_number: `${aptBlockName}-101`,
      block_id: aptBlock.id,
      flat_type: "1BHK",
      occupancy_status: "OWNER_OCCUPIED",
    });
    const f2 = await Flat.create({
      flat_number: `${aptBlockName}-201`,
      block_id: aptBlock.id,
      flat_type: "2BHK",
      occupancy_status: "OWNER_OCCUPIED",
    });
    const f3 = await Flat.create({
      flat_number: `${aptBlockName}-301`,
      block_id: aptBlock.id,
      flat_type: "3BHK",
      occupancy_status: "OWNER_OCCUPIED",
    });
    testFlatIds.push(f1.id, f2.id, f3.id);

    // Create a Row House Block with row house property
    const rowBlockName = unique("BlkRow");
    const rowBlock = await Block.create({
      name: rowBlockName,
      society_id: societyId,
      property_type: "ROW_HOUSE",
    });
    testBlockIds.push(rowBlock.id);

    const rowFlat = await Flat.create({
      flat_number: `${rowBlockName}-R1`,
      block_id: rowBlock.id,
      occupancy_status: "OWNER_OCCUPIED",
      area_sqft: 1800,
    });
    testFlatIds.push(rowFlat.id);

    // Assign owner membership to all test flats
    for (const flatId of testFlatIds) {
      await FlatMembership.create({
        flat_id: flatId,
        user_id: testOwnerUser.id,
        society_id: societyId,
        role: "OWNER",
        is_staying: true,
        pays_maintenance: true,
        is_current: true,
      });
    }
  });

  afterAll(async () => {
    // Cleanup generated bills
    if (testFlatIds.length > 0) {
      try {
        await Bill.destroy({ where: { flat_id: testFlatIds } });
      } catch {}
    }

    // Cleanup rates
    if (testRateIds.length > 0) {
      try {
        await MaintenanceRate.destroy({ where: { id: testRateIds } });
      } catch {}
    }

    // Cleanup memberships and flats
    if (testFlatIds.length > 0) {
      try {
        await FlatMembership.destroy({ where: { flat_id: testFlatIds } });
        await Flat.destroy({ where: { id: testFlatIds } });
      } catch {}
    }

    // Cleanup blocks
    if (testBlockIds.length > 0) {
      try {
        await Block.destroy({ where: { id: testBlockIds } });
      } catch {}
    }

    // Cleanup test user
    if (testOwnerUser) {
      try {
        await User.destroy({ where: { id: testOwnerUser.id } });
      } catch {}
    }
  });

  it("1. Successfully creates an 'All BHK' maintenance configuration", async () => {
    const res = await request(app)
      .post("/api/maintenance/config")
      .set(adminSession.headers)
      .send({
        maintenance_type: "FLAT",
        flat_type: "ALL",
        resident_type: "OWNER",
        amount: 1500,
        frequency: "MONTHLY",
        name: "Common All BHK Maintenance",
        is_active: true,
      });

    expectOk(res);
    expect(res.body.rate).toBeDefined();
    expect(res.body.rate.flat_type).toBe("ALL");
    expect(Number(res.body.rate.amount)).toBe(1500);
    testRateIds.push(res.body.rate.id);
  });

  it("2. Successfully creates an individual '1BHK' configuration without modifying 'All BHK'", async () => {
    const res = await request(app)
      .post("/api/maintenance/config")
      .set(adminSession.headers)
      .send({
        maintenance_type: "FLAT",
        flat_type: "1BHK",
        resident_type: "OWNER",
        amount: 1000,
        frequency: "MONTHLY",
        name: "Special 1BHK Rate",
        is_active: true,
      });

    expectOk(res);
    expect(res.body.rate).toBeDefined();
    expect(res.body.rate.flat_type).toBe("1BHK");
    expect(Number(res.body.rate.amount)).toBe(1000);
    testRateIds.push(res.body.rate.id);

    // Verify All BHK configuration remains untouched in DB
    const allRate = await MaintenanceRate.findOne({
      where: { society_id: societyId, maintenance_type: "FLAT", flat_type: "ALL" },
    });
    expect(allRate).not.toBeNull();
    expect(Number(allRate.amount)).toBe(1500);
  });

  it("3. Priority Resolution: 1BHK uses individual rate (₹1000) while 2BHK and 3BHK fall back to All BHK (₹1500)", async () => {
    const testMonth = "October 2029";
    const res = await request(app)
      .post("/api/maintenance/preview")
      .set(adminSession.headers)
      .send({
        billing_month: testMonth,
        rate_ids: testRateIds,
      });

    expectOk(res);
    const residents = res.body.residents || [];

    // Filter to our test flats
    const f1Item = residents.find((r) => r.flat_id === testFlatIds[0]); // 1BHK
    const f2Item = residents.find((r) => r.flat_id === testFlatIds[1]); // 2BHK
    const f3Item = residents.find((r) => r.flat_id === testFlatIds[2]); // 3BHK

    expect(f1Item).toBeDefined();
    expect(f1Item.amount).toBe(1000); // 1BHK individual rate took priority
    expect(f1Item.calculation_details.applied_config).toBe("INDIVIDUAL_BHK");

    expect(f2Item).toBeDefined();
    expect(f2Item.amount).toBe(1500); // 2BHK fell back to All BHK rate
    expect(f2Item.calculation_details.applied_config).toBe("ALL_BHK");

    expect(f3Item).toBeDefined();
    expect(f3Item.amount).toBe(1500); // 3BHK fell back to All BHK rate
    expect(f3Item.calculation_details.applied_config).toBe("ALL_BHK");
  });

  it("4. Inactive Rate Fallback: When 1BHK individual rate is deactivated, 1BHK falls back to active All BHK (₹1500)", async () => {
    const testMonth = "November 2029";
    // Deactivate 1BHK rate
    await MaintenanceRate.update(
      { is_active: false },
      { where: { society_id: societyId, maintenance_type: "FLAT", flat_type: "1BHK" } }
    );

    const res = await request(app)
      .post("/api/maintenance/preview")
      .set(adminSession.headers)
      .send({
        billing_month: testMonth,
        rate_ids: testRateIds,
      });

    expectOk(res);
    const f1Item = res.body.residents.find((r) => r.flat_id === testFlatIds[0]);
    expect(f1Item).toBeDefined();
    expect(f1Item.amount).toBe(1500); // Now falls back to All BHK
    expect(f1Item.calculation_details.applied_config).toBe("ALL_BHK");

    // Reactivate 1BHK rate for subsequent tests
    await MaintenanceRate.update(
      { is_active: true },
      { where: { society_id: societyId, maintenance_type: "FLAT", flat_type: "1BHK" } }
    );
  });

  it("5. Lumpsum Billing: Applies the exact same fixed amount to both Flat Owners and Row House Owners", async () => {
    const lumpRes = await request(app)
      .post("/api/maintenance/config")
      .set(adminSession.headers)
      .send({
        maintenance_type: "LUMPSUM",
        amount: 3000,
        frequency: "MONTHLY",
        name: "General Lumpsum Maintenance",
        is_active: true,
      });

    expectOk(lumpRes);
    const lumpRateId = lumpRes.body.rate.id;
    testRateIds.push(lumpRateId);

    const testMonth = "December 2029";
    const previewRes = await request(app)
      .post("/api/maintenance/preview")
      .set(adminSession.headers)
      .send({
        billing_month: testMonth,
        rate_ids: [lumpRateId],
      });

    expectOk(previewRes);
    const residents = previewRes.body.residents || [];

    const f1Item = residents.find((r) => r.flat_id === testFlatIds[0]); // Flat 1BHK
    const rowItem = residents.find((r) => r.flat_id === testFlatIds[3]); // Row House R1

    expect(f1Item).toBeDefined();
    expect(f1Item.amount).toBe(3000);
    expect(f1Item.property_type).toBe("APARTMENT");

    expect(rowItem).toBeDefined();
    expect(rowItem.amount).toBe(3000);
    expect(rowItem.property_type).toBe("ROW_HOUSE");
  });

  it("6. Bill Generation: Successfully generates maintenance bills without generating duplicate bills for the same property", async () => {
    const testMonth = "January 2030";
    const genRes = await request(app)
      .post("/api/maintenance/generate")
      .set(adminSession.headers)
      .send({
        billing_month: testMonth,
        rate_ids: "ALL",
      });

    expectOk(genRes);
    expect(genRes.body.summary).toBeDefined();
    expect(genRes.body.summary.generated).toBeGreaterThan(0);

    // Try generating again for the same month - duplicate prevention must skip them
    const genRepeatRes = await request(app)
      .post("/api/maintenance/generate")
      .set(adminSession.headers)
      .send({
        billing_month: testMonth,
        rate_ids: "ALL",
      });

    expectOk(genRepeatRes);
    expect(genRepeatRes.body.summary.generated).toBe(0);
    expect(genRepeatRes.body.summary.skipped_duplicates).toBeGreaterThan(0);
  });
});

