const request = require("supertest");
const app = require("../app");
const {
  sequelize,
  Society,
  CleaningStaff,
  CleaningStaffPass,
  CleaningStaffAttendance,
  GuardShift,
} = require("../models");
const { login } = require("./helpers/api");
const { getCurrentISTDate } = require("../utils/istTime");
const {
  MAX_SCANS_PER_DAY,
  generatePassCode,
  evaluatePassUsability,
  calculateWorkedMinutes,
  resolveScanDirection,
  isDateInRange,
  datesOverlap,
  passRange,
  passesOverlap,
} = require("../utils/cleaningStaffUtils");

/* ═══════════════════════════════════════════════════════════════════════════
   CLEANING STAFF MANAGEMENT — Phase 2 backend suite

   Self-contained: every fixture is created by this file and removed in
   afterAll. It never reads or writes the pre-existing VisitorPreApproval /
   VisitorLog rows and it does not depend on any other suite's fixtures, so it
   can be run on its own with:
       npx jest tests/cleaning-staff.test.js
   ═══════════════════════════════════════════════════════════════════════════ */

const createdStaffIds = [];
const createdPassIds = [];
const createdShiftIds = [];
const createdSocietyIds = [];
const today = getCurrentISTDate();

/**
 * Create the four tables from the model definitions.
 *
 * force:true drops and recreates them so the schema always matches the models.
 * That is safe here only because these tables belong exclusively to this brand
 * new module, there is no legacy data to preserve, and the suite already runs
 * against an isolated test database (see tests/setup.js, which refuses to point
 * at the development DB). No pre-existing table in the project is touched.
 *
 * FOREIGN_KEY_CHECKS is disabled for the recreate because MySQL refuses to drop
 * `cleaning_staff` while the three child tables still reference it, and the
 * models must be synced parent-first to build the FKs.
 */
beforeAll(async () => {
  await sequelize.query("SET FOREIGN_KEY_CHECKS=0");
  try {
    await CleaningStaff.sync({ force: true });
    await CleaningStaffPass.sync({ force: true });
    await CleaningStaffAttendance.sync({ force: true });
  } finally {
    await sequelize.query("SET FOREIGN_KEY_CHECKS=1");
  }
});

/**
 * A second, real society to prove scoping.
 * Cannot use societyId + 999: sync() creates a genuine foreign key from
 * cleaning_staff.society_id to societies.id, so a non-existent id is rejected
 * by MySQL before the controller is even reached.
 */
const makeForeignSociety = async (label) => {
  const society = await Society.create({ name: `Cleaning Test ${label}-${Date.now()}` });
  createdSocietyIds.push(society.id);
  return society;
};

const makeStaff = async (societyId, overrides = {}) =>
  CleaningStaff.create({
    society_id: societyId,
    name: "Test Cleaner",
    phone: "9876543210",
    status: "ACTIVE",
    ...overrides,
  });

/**
 * Scan-test plumbing that must be reachable from more than one describe block.
 * Populated by the gate-scan suite's beforeAll.
 */
const scanCtx = { admin: null, societyId: null };

/** Issue a pass valid today for a fresh staff member. */
const issuePassForNewStaff = async (name) => {
  const staff = await makeStaff(scanCtx.societyId, { name });
  createdStaffIds.push(staff.id);

  const res = await request(app)
    .post(`/api/cleaning-staff/${staff.id}/passes`)
    .set(scanCtx.admin.headers)
    .send({ valid_date: today });

  expect(res.status).toBe(201);
  createdPassIds.push(res.body.data.id);
  return { staff, passCode: res.body.data.pass_code };
};

afterAll(async () => {
  await sequelize.query("SET FOREIGN_KEY_CHECKS=0");
  for (const id of createdPassIds) await CleaningStaffPass.destroy({ where: { id }, force: true }).catch(() => {});
  await CleaningStaffAttendance.destroy({ where: { cleaning_staff_id: createdStaffIds }, force: true }).catch(() => {});
  await CleaningStaffPass.destroy({ where: { cleaning_staff_id: createdStaffIds }, force: true }).catch(() => {});
  await CleaningStaff.destroy({ where: { id: createdStaffIds }, force: true }).catch(() => {});
  for (const id of createdShiftIds) await GuardShift.destroy({ where: { id }, force: true }).catch(() => {});
  for (const id of createdSocietyIds) await Society.destroy({ where: { id }, force: true }).catch(() => {});
  await sequelize.query("SET FOREIGN_KEY_CHECKS=1");
});

describe("Cleaning Staff — pure helpers", () => {
  it("generates pass codes in GP-XXXXXX format", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePassCode();
      expect(code).toMatch(/^GP-\d{6}$/);
      expect(code).toHaveLength(9);
    }
  });

  it("generates distinct pass codes", () => {
    const codes = new Set(Array.from({ length: 25 }, generatePassCode));
    expect(codes.size).toBe(25);
  });

  it("treats an open-ended range as unbounded", () => {
    expect(isDateInRange(today, "2026-01-01", null)).toBe(true);
    expect(isDateInRange(today, "2099-01-01", null)).toBe(false);
  });

  it("detects overlapping date ranges including open-ended ones", () => {
    expect(datesOverlap("2026-10-01", "2026-10-10", "2026-10-05", "2026-10-20")).toBe(true);
    expect(datesOverlap("2026-10-01", "2026-10-04", "2026-10-05", "2026-10-20")).toBe(false);
    expect(datesOverlap("2026-10-01", null, "2026-10-05", "2026-10-20")).toBe(true);
  });

  it("treats a pass with no valid_until as covering exactly one day", () => {
    /* Regression guard. A single-day pass must NOT block every later pass,
       which is what happens if its missing end date is read as "unbounded". */
    const singleDay = { valid_date: "2033-01-01", valid_until: null };
    expect(passRange(singleDay)).toEqual({ start: "2033-01-01", end: "2033-01-01" });

    expect(passesOverlap(singleDay, "2033-01-01", null)).toBe(true);
    expect(passesOverlap(singleDay, "2033-01-02", null)).toBe(false);
    expect(passesOverlap(singleDay, "2035-06-01", null)).toBe(false);
  });

  it("detects overlapping multi-day pass ranges", () => {
    const ranged = { valid_date: "2033-01-01", valid_until: "2033-01-31" };
    expect(passesOverlap(ranged, "2033-01-15", "2033-02-10")).toBe(true);
    expect(passesOverlap(ranged, "2033-02-01", "2033-02-10")).toBe(false);
  });

  it("computes worked minutes and refuses an incomplete pair", () => {
    expect(calculateWorkedMinutes("2026-10-02T02:00:00Z", "2026-10-02T03:30:00Z")).toBe(90);
    expect(calculateWorkedMinutes(null, "2026-10-02T03:30:00Z")).toBeNull();
    expect(calculateWorkedMinutes("2026-10-02T03:30:00Z", "2026-10-02T02:00:00Z")).toBe(0);
  });

  it("resolves the scan direction from the attendance row", () => {
    expect(resolveScanDirection(null)).toBe("IN");
    expect(resolveScanDirection({ check_in: null })).toBe("IN");
    expect(resolveScanDirection({ check_in: new Date(), check_out: null })).toBe("OUT");
    expect(resolveScanDirection({ check_in: new Date(), check_out: new Date() })).toBe("COMPLETED");
  });

  it("blocks entry on revoked / expired / not-yet-valid passes", () => {
    expect(evaluatePassUsability({ status: "REVOKED" }, today).usableForEntry).toBe(false);
    expect(
      evaluatePassUsability({ status: "ACTIVE", valid_date: "2020-01-01", valid_until: "2020-01-02" }, today).code
    ).toBe("PASS_EXPIRED");
    const future = evaluatePassUsability({ status: "ACTIVE", valid_date: "2099-01-01" }, today);
    expect(future.code).toBe("PASS_NOT_YET_VALID");
    expect(future.usableForEntry).toBe(false);
  });

  it("caps max_scans_per_day at 2", () => {
    expect(MAX_SCANS_PER_DAY).toBe(2);
  });
});

describe("Cleaning Staff — auth and RBAC", () => {
  it("requires authentication on every module route", async () => {
    const routes = [
      ["get", "/api/cleaning-staff"],
      ["get", "/api/cleaning-staff/1"],
      ["post", "/api/cleaning-staff"],
      ["put", "/api/cleaning-staff/1"],
      ["patch", "/api/cleaning-staff/1/status"],
      ["delete", "/api/cleaning-staff/1"],
      ["get", "/api/cleaning-staff/1/passes"],
      ["post", "/api/cleaning-staff/1/passes"],
      ["get", "/api/cleaning-staff/1/attendance"],
      ["get", "/api/cleaning-staff/attendance"],
      ["patch", "/api/cleaning-staff/attendance/1"],
      ["patch", "/api/cleaning-staff/passes/1/revoke"],
      ["post", "/api/cleaning-staff/scan"],
    ];

    for (const [method, path] of routes) {
      const res = await request(app)[method](path).send({});
      expect([401, 403]).toContain(res.status);
    }
  });

  it("forbids a resident from the module", async () => {
    const session = await login("resident");
    const res = await request(app).get("/api/cleaning-staff").set(session.headers);
    expect(res.status).toBe(403);
  });

  it("forbids an accountant from the module", async () => {
    const session = await login("accountant");
    const res = await request(app).get("/api/cleaning-staff").set(session.headers);
    expect(res.status).toBe(403);
  });

  it("allows an admin to list", async () => {
    const session = await login("admin");
    const res = await request(app).get("/api/cleaning-staff").set(session.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("Cleaning Staff — staff CRUD", () => {
  let admin;
  let societyId;

  beforeAll(async () => {
    admin = await login("admin");
    societyId = admin.user.society_id;
  });

  it("creates a staff record with defaults", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff")
      .set(admin.headers)
      .send({ name: "Ramesh Kumar", phone: "9876543210", designation: "Maaid", monthly_wage: 12000 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Ramesh Kumar");
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.society_id).toBe(societyId);
    createdStaffIds.push(res.body.data.id);
  });

  it("rejects an invalid mobile number", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff")
      .set(admin.headers)
      .send({ name: "Bad Phone", phone: "12345" });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff")
      .set(admin.headers)
      .send({ name: "Bad Email", email: "not-an-email" });

    expect(res.status).toBe(400);
  });

  it("rejects a malformed joining date", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff")
      .set(admin.headers)
      .send({ name: "Bad Date", joining_date: "02-10-2026" });

    expect(res.status).toBe(400);
  });

  it("reads a single staff record scoped to the society", async () => {
    const created = await makeStaff(societyId, { name: "Solo Read" });
    createdStaffIds.push(created.id);

    const res = await request(app).get(`/api/cleaning-staff/${created.id}`).set(admin.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.id);
  });

  it("returns 404 for a staff id that does not exist", async () => {
    const res = await request(app).get("/api/cleaning-staff/99999999").set(admin.headers);
    expect(res.status).toBe(404);
  });

  it("hides another society's staff behind a 404, never a cross-society read", async () => {
    const foreign = await makeForeignSociety("roster");
    const foreignStaff = await CleaningStaff.create({
      society_id: foreign.id,
      name: "Foreign Cleaner",
      status: "ACTIVE",
    });

    const res = await request(app).get(`/api/cleaning-staff/${foreignStaff.id}`).set(admin.headers);
    expect(res.status).toBe(404);

    const list = await request(app).get("/api/cleaning-staff").set(admin.headers);
    expect(list.body.data.map((s) => s.id)).not.toContain(foreignStaff.id);

    await CleaningStaff.destroy({ where: { id: foreignStaff.id }, force: true });
  });

  it("updates a staff record", async () => {
    const created = await makeStaff(societyId, { name: "Update Target" });
    createdStaffIds.push(created.id);

    const res = await request(app)
      .put(`/api/cleaning-staff/${created.id}`)
      .set(admin.headers)
      .send({ name: "Updated Name", designation: "Supervisor" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Updated Name");
    expect(res.body.data.designation).toBe("Supervisor");
  });

  it("toggles ACTIVE / INACTIVE through the status endpoint", async () => {
    const created = await makeStaff(societyId, { name: "Toggle Target" });
    createdStaffIds.push(created.id);

    const off = await request(app)
      .patch(`/api/cleaning-staff/${created.id}/status`)
      .set(admin.headers)
      .send({ status: "INACTIVE" });
    expect(off.status).toBe(200);
    expect(off.body.data.status).toBe("INACTIVE");

    const on = await request(app)
      .patch(`/api/cleaning-staff/${created.id}/status`)
      .set(admin.headers)
      .send({ status: "ACTIVE" });
    expect(on.status).toBe(200);
    expect(on.body.data.status).toBe("ACTIVE");
  });

  it("rejects an unknown status value", async () => {
    const created = await makeStaff(societyId);
    createdStaffIds.push(created.id);

    const res = await request(app)
      .patch(`/api/cleaning-staff/${created.id}/status`)
      .set(admin.headers)
      .send({ status: "TERMINATED" });

    expect(res.status).toBe(400);
  });

  it("refuses a hard delete so history is preserved", async () => {
    const created = await makeStaff(societyId);
    createdStaffIds.push(created.id);

    const res = await request(app).delete(`/api/cleaning-staff/${created.id}`).set(admin.headers);
    expect(res.status).toBe(405);

    const still = await CleaningStaff.findByPk(created.id);
    expect(still).not.toBeNull();
  });

  it("filters the list by status and search", async () => {
    const created = await makeStaff(societyId, { name: "Filterable Person", status: "INACTIVE" });
    createdStaffIds.push(created.id);

    const res = await request(app)
      .get("/api/cleaning-staff?status=INACTIVE&search=Filterable")
      .set(admin.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === created.id)).toBe(true);
  });

  it("deactivating a staff member revokes their active pass", async () => {
    const created = await makeStaff(societyId, { name: "Pass Revoker" });
    createdStaffIds.push(created.id);

    const pass = await CleaningStaffPass.create({
      cleaning_staff_id: created.id,
      society_id: societyId,
      pass_code: generatePassCode(),
      valid_date: today,
      status: "ACTIVE",
      max_scans_per_day: MAX_SCANS_PER_DAY,
    });
    createdPassIds.push(pass.id);

    await request(app)
      .patch(`/api/cleaning-staff/${created.id}/status`)
      .set(admin.headers)
      .send({ status: "INACTIVE" });

    await pass.reload();
    expect(pass.status).toBe("REVOKED");
  });
});

describe("Cleaning Staff — passes", () => {
  let admin;
  let societyId;
  let staff;

  beforeAll(async () => {
    admin = await login("admin");
    societyId = admin.user.society_id;
    staff = await makeStaff(societyId, { name: "Pass Holder" });
    createdStaffIds.push(staff.id);
  });

  it("issues a pass with a GP- code and max_scans_per_day of 2", async () => {
    const res = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: today });

    expect(res.status).toBe(201);
    expect(res.body.data.pass_code).toMatch(/^GP-\d{6}$/);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.max_scans_per_day).toBe(2);
    createdPassIds.push(res.body.data.id);
  });

  it("refuses to let a client raise max_scans_per_day", async () => {
    const res = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: today, max_scans_per_day: 99 });

    expect(res.status).toBe(409); // overlaps the pass issued above
  });

  it("returns 409 for an overlapping active pass", async () => {
    const first = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2030-01-01", valid_until: "2030-01-31" });
    expect(first.status).toBe(201);
    createdPassIds.push(first.body.data.id);

    const second = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2030-01-15", valid_until: "2030-02-10" });

    expect(second.status).toBe(409);
    expect(second.body.existing_pass).toBeTruthy();

    /* Clean up so later tests on this staff member are not blocked. */
    await CleaningStaffPass.update(
      { status: "REVOKED" },
      { where: { id: first.body.data.id } }
    );
  });

  it("allows a new pass once the previous one is revoked", async () => {
    const revoked = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2031-01-01" });
    expect(revoked.status).toBe(201);
    createdPassIds.push(revoked.body.data.id);

    await request(app)
      .patch(`/api/cleaning-staff/passes/${revoked.body.data.id}/revoke`)
      .set(admin.headers)
      .send({ reason: "test cleanup" });

    const next = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2031-01-01" });
    expect(next.status).toBe(201);
    createdPassIds.push(next.body.data.id);
  });

  it("rejects an inverted validity range", async () => {
    const res = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2032-05-10", valid_until: "2032-05-01" });

    expect(res.status).toBe(400);
  });

  it("rejects a missing or malformed valid_date", async () => {
    const missing = await request(app).post(`/api/cleaning-staff/${staff.id}/passes`).set(admin.headers).send({});
    expect(missing.status).toBe(400);

    const malformed = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "01/05/2032" });
    expect(malformed.status).toBe(400);
  });

  it("refuses to issue a pass for an INACTIVE staff member", async () => {
    const inactive = await makeStaff(societyId, { name: "Inactive Staff", status: "INACTIVE" });
    createdStaffIds.push(inactive.id);

    const res = await request(app)
      .post(`/api/cleaning-staff/${inactive.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: today });

    expect(res.status).toBe(400);
  });

  it("lists pass history for a staff member", async () => {
    const res = await request(app).get(`/api/cleaning-staff/${staff.id}/passes`).set(admin.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("revokes a pass and records who did it", async () => {
    const pass = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2033-01-01" });
    expect(pass.status).toBe(201);
    createdPassIds.push(pass.body.data.id);

    const res = await request(app)
      .patch(`/api/cleaning-staff/passes/${pass.body.data.id}/revoke`)
      .set(admin.headers)
      .send({ reason: "left the society" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REVOKED");
    expect(res.body.data.revoked_by).toBe(admin.user.id);
    expect(res.body.data.revoke_reason).toBe("left the society");
  });

  it("refuses to revoke an already-revoked pass", async () => {
    const pass = await request(app)
      .post(`/api/cleaning-staff/${staff.id}/passes`)
      .set(admin.headers)
      .send({ valid_date: "2034-01-01" });
    createdPassIds.push(pass.body.data.id);

    await request(app)
      .patch(`/api/cleaning-staff/passes/${pass.body.data.id}/revoke`)
      .set(admin.headers)
      .send({});

    const again = await request(app)
      .patch(`/api/cleaning-staff/passes/${pass.body.data.id}/revoke`)
      .set(admin.headers)
      .send({});
    expect(again.status).toBe(400);
  });

  it("enforces pass_code uniqueness at the database level", async () => {
    const code = generatePassCode();

    const a = await CleaningStaffPass.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      pass_code: code,
      valid_date: today,
      status: "ACTIVE",
      max_scans_per_day: MAX_SCANS_PER_DAY,
    });
    createdPassIds.push(a.id);

    await expect(
      CleaningStaffPass.create({
        cleaning_staff_id: staff.id,
        society_id: societyId,
        pass_code: code,
        valid_date: today,
        status: "ACTIVE",
        max_scans_per_day: MAX_SCANS_PER_DAY,
      })
    ).rejects.toHaveProperty("name", "SequelizeUniqueConstraintError");
  });
});

describe("Cleaning Staff — gate scan", () => {
  let admin;
  let guard;
  let societyId;

  beforeAll(async () => {
    admin = await login("admin");
    guard = await login("guard");
    societyId = admin.user.society_id;

    /* Guarantee the fixture guard is on duty right now, regardless of the hour
       the suite happens to run: give every shift type a full-day window. */
    const { GuardShiftTiming } = require("../models");
    const { getCurrentShiftTypeFromTimings } = require("../utils/shiftTiming");
    for (const shiftType of ["MORNING", "AFTERNOON", "NIGHT"]) {
      await GuardShiftTiming.upsert(
        {
          society_id: societyId,
          shift_type: shiftType,
          start_time: "00:00",
          end_time: "23:59",
        },
        { where: { society_id: societyId, shift_type: shiftType } }
      );
    }

    const shift = await GuardShift.create({
      guard_id: guard.user.id,
      society_id: societyId,
      shift_type: getCurrentShiftTypeFromTimings(
        await GuardShiftTiming.findAll({ where: { society_id: societyId } }).then((rows) =>
          Object.fromEntries(
            rows.map((r) => [r.shift_type, { start: r.start_time, end: r.end_time }])
          )
        )
      ),
      start_date: today,
      end_date: today,
    });
    createdShiftIds.push(shift.id);

    scanCtx.admin = admin;
    scanCtx.societyId = societyId;
  });

  it("rejects a malformed pass code without touching the DB", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: "not-a-code" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PASS_CODE");
  });

  it("rejects an unknown pass code", async () => {
    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: "GP-999999" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASS_NOT_FOUND");
  });

  it("refuses a cross-society pass code", async () => {
    const foreign = await makeForeignSociety("pass");
    const foreignStaff = await CleaningStaff.create({
      society_id: foreign.id,
      name: "Foreign Pass",
      status: "ACTIVE",
    });
    const foreignPass = await CleaningStaffPass.create({
      cleaning_staff_id: foreignStaff.id,
      society_id: foreign.id,
      pass_code: generatePassCode(),
      valid_date: today,
      status: "ACTIVE",
      max_scans_per_day: MAX_SCANS_PER_DAY,
    });

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: foreignPass.pass_code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASS_NOT_FOUND");

    await CleaningStaffPass.destroy({ where: { id: foreignPass.id }, force: true });
    await CleaningStaff.destroy({ where: { id: foreignStaff.id }, force: true });
  });

  it("records the first scan as IN", async () => {
    const { staff, passCode } = await issuePassForNewStaff("Scanner One");

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: passCode });

    expect(res.status).toBe(200);
    expect(res.body.scan_type).toBe("IN");
    expect(res.body.staff_name).toBe("Scanner One");
    expect(res.body.attendance_date).toBe(today);
    expect(res.body.scans_used).toBe(1);
    expect(res.body.max_scans_per_day).toBe(2);
    expect(res.body.scans_remaining).toBe(1);
    expect(res.body.attendance.check_in).toBeTruthy();
    expect(res.body.attendance.check_out).toBeNull();

    const row = await CleaningStaffAttendance.findOne({
      where: { cleaning_staff_id: staff.id, attendance_date: today },
    });
    expect(row.scan_count).toBe(1);
  });

  it("records the second scan as OUT and computes worked_minutes", async () => {
    const { staff, passCode } = await issuePassForNewStaff("Scanner Two");

    await request(app).post("/api/cleaning-staff/scan").set(guard.headers).send({ pass_code: passCode });
    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: passCode });

    expect(res.status).toBe(200);
    expect(res.body.scan_type).toBe("OUT");
    expect(res.body.scans_used).toBe(2);
    expect(res.body.scans_remaining).toBe(0);
    expect(typeof res.body.worked_minutes).toBe("number");
    expect(res.body.worked_minutes).toBeGreaterThanOrEqual(0);
    expect(res.body.attendance.check_out).toBeTruthy();
  });

  it("rejects a third scan on the same day with 400", async () => {
    const { passCode } = await issuePassForNewStaff("Scanner Three");

    await request(app).post("/api/cleaning-staff/scan").set(guard.headers).send({ pass_code: passCode });
    await request(app).post("/api/cleaning-staff/scan").set(guard.headers).send({ pass_code: passCode });

    const third = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: passCode });

    expect(third.status).toBe(400);
    expect(third.body.code).toBe("DAILY_LIMIT_REACHED");
    expect(third.body.max_scans_per_day).toBe(2);
  });

  it("keeps exactly one attendance row per staff member per day", async () => {
    const { staff, passCode } = await issuePassForNewStaff("Single Row");

    await request(app).post("/api/cleaning-staff/scan").set(guard.headers).send({ pass_code: passCode });
    await request(app).post("/api/cleaning-staff/scan").set(guard.headers).send({ pass_code: passCode });

    const rows = await CleaningStaffAttendance.findAll({
      where: { cleaning_staff_id: staff.id, attendance_date: today },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].scan_count).toBe(2);
  });

  it("refuses IN on a revoked pass but still allows the matching OUT", async () => {
    const { staff, passCode } = await issuePassForNewStaff("Revoked Mid Day");

    /* First scan is a legitimate IN. */
    const inRes = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: passCode });
    expect(inRes.status).toBe(200);
    expect(inRes.body.scan_type).toBe("IN");

    /* Pass is then revoked while the staff member is still inside. */
    const pass = await CleaningStaffPass.findOne({ where: { pass_code: passCode } });
    await pass.update({ status: "REVOKED", revoked_at: new Date() });

    /* OUT must still succeed so staff are never trapped inside. */
    const outRes = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: passCode });

    expect(outRes.status).toBe(200);
    expect(outRes.body.scan_type).toBe("OUT");
    expect(outRes.body.worked_minutes).toBeGreaterThanOrEqual(0);
  });

  it("refuses IN on an expired pass", async () => {
    const staff = await makeStaff(societyId, { name: "Expired Pass" });
    createdStaffIds.push(staff.id);

    const pass = await CleaningStaffPass.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      pass_code: generatePassCode(),
      valid_date: "2020-01-01",
      valid_until: "2020-01-02",
      status: "ACTIVE",
      max_scans_per_day: MAX_SCANS_PER_DAY,
    });
    createdPassIds.push(pass.id);

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: pass.pass_code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASS_EXPIRED");
  });

  it("refuses IN on a pass that is not active yet", async () => {
    const staff = await makeStaff(societyId, { name: "Future Pass" });
    createdStaffIds.push(staff.id);

    const pass = await CleaningStaffPass.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      pass_code: generatePassCode(),
      valid_date: "2099-01-01",
      status: "ACTIVE",
      max_scans_per_day: MAX_SCANS_PER_DAY,
    });
    createdPassIds.push(pass.id);

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(guard.headers)
      .send({ pass_code: pass.pass_code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASS_NOT_YET_VALID");
  });

  it("refuses a non-guard scanner", async () => {
    const { passCode } = await issuePassForNewStaff("Admin Scan");

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(admin.headers)
      .send({ pass_code: passCode });

    expect([403]).toContain(res.status);
  });

  it("refuses a guard whose shift does not cover today", async () => {
    /* The fixture guard is on duty from beforeAll. This second guard user has no
       GuardShift at all, proving the endpoint checks the CALLER's shift rather
       than merely the guard role. */
    const { User } = require("../models");
    const bcrypt = require("bcryptjs");
    const otherGuard = await User.create({
      society_id: societyId,
      name: "Off Duty Guard",
      email: `offduty-${Date.now()}@yopmail.com`,
      /* login() compares with bcrypt, so a plaintext password never matches. */
      password: await bcrypt.hash("Admin@123", 10),
      role: "GUARD",
      roles: ["GUARD"],
      status: "ACTIVE",
      /* login() refuses a registration that is still PENDING. */
      approval_status: "APPROVED",
    });

    const { passCode } = await issuePassForNewStaff("Off Duty Scan");

    /* Log in as the off-duty guard. */
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: otherGuard.email, password: "Admin@123" });
    expect(loginRes.status).toBe(200);

    const otpRes = await request(app)
      .post("/api/auth/verify-otp")
      .send({ otp: "123456", tempToken: loginRes.body.tempToken });
    expect(otpRes.status).toBe(200);

    const headers = { Authorization: `Bearer ${otpRes.body.token}` };
    if (otpRes.body.user?.society_id) {
      headers["x-society-id"] = String(otpRes.body.user.society_id);
    }

    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(headers)
      .send({ pass_code: passCode });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("GUARD_OFF_DUTY");

    await User.destroy({ where: { id: otherGuard.id }, force: true });
  });

  it("refuses a non-guard identity even in an allowed role family", async () => {
    const committee = await login("committee");
    const res = await request(app)
      .post("/api/cleaning-staff/scan")
      .set(committee.headers)
      .send({ pass_code: generatePassCode() });

    expect(res.status).toBe(403);
  });
});

describe("Cleaning Staff — attendance views and corrections", () => {
  let admin;
  let societyId;

  beforeAll(async () => {
    admin = await login("admin");
    societyId = admin.user.society_id;
  });

  it("returns society-wide attendance, defaulting to today", async () => {
    const res = await request(app).get("/api/cleaning-staff/attendance").set(admin.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("rejects a malformed date filter", async () => {
    const res = await request(app)
      .get("/api/cleaning-staff/attendance?date=not-a-date")
      .set(admin.headers);
    expect(res.status).toBe(400);
  });

  it("requires a note for a manual correction", async () => {
    const staff = await makeStaff(societyId, { name: "Correction Target" });
    createdStaffIds.push(staff.id);

    const record = await CleaningStaffAttendance.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      attendance_date: "2026-06-15",
      check_in: new Date("2026-06-15T02:00:00Z"),
      check_out: new Date("2026-06-15T04:00:00Z"),
      worked_minutes: 120,
      scan_count: 2,
    });

    const res = await request(app)
      .patch(`/api/cleaning-staff/attendance/${record.id}`)
      .set(admin.headers)
      .send({ check_out: "2026-06-15T05:00:00.000Z" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOTES_REQUIRED");

    await record.destroy({ force: true });
  });

  it("applies a manual correction and flags it for audit", async () => {
    const staff = await makeStaff(societyId, { name: "Correction Applied" });
    createdStaffIds.push(staff.id);

    const record = await CleaningStaffAttendance.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      attendance_date: "2026-06-16",
      check_in: new Date("2026-06-16T02:00:00Z"),
      check_out: new Date("2026-06-16T03:00:00Z"),
      worked_minutes: 60,
      scan_count: 2,
    });

    const res = await request(app)
      .patch(`/api/cleaning-staff/attendance/${record.id}`)
      .set(admin.headers)
      .send({ check_out: "2026-06-16T05:00:00.000Z", notes: "gate scanner was offline" });

    expect(res.status).toBe(200);
    expect(res.body.data.is_manual).toBe(true);
    expect(res.body.data.manually_edited_by).toBe(admin.user.id);
    expect(res.body.data.notes).toBe("gate scanner was offline");
    expect(res.body.data.worked_minutes).toBe(180);

    await record.destroy({ force: true });
  });

  it("rejects a correction that puts check_out before check_in", async () => {
    const staff = await makeStaff(societyId, { name: "Inverted Correction" });
    createdStaffIds.push(staff.id);

    const record = await CleaningStaffAttendance.create({
      cleaning_staff_id: staff.id,
      society_id: societyId,
      attendance_date: "2026-06-17",
      check_in: new Date("2026-06-17T05:00:00Z"),
      scan_count: 1,
    });

    const res = await request(app)
      .patch(`/api/cleaning-staff/attendance/${record.id}`)
      .set(admin.headers)
      .send({ check_out: "2026-06-17T01:00:00.000Z", notes: "typo" });

    expect(res.status).toBe(400);

    await record.destroy({ force: true });
  });

  it("never exposes another society's attendance row", async () => {
    const foreign = await makeForeignSociety("attendance");
    const foreignStaff = await CleaningStaff.create({
      society_id: foreign.id,
      name: "Foreign Attendance",
      status: "ACTIVE",
    });
    const foreignRow = await CleaningStaffAttendance.create({
      cleaning_staff_id: foreignStaff.id,
      society_id: foreign.id,
      attendance_date: "2026-06-18",
      scan_count: 1,
    });

    const res = await request(app)
      .patch(`/api/cleaning-staff/attendance/${foreignRow.id}`)
      .set(admin.headers)
      .send({ notes: "should not work" });

    expect(res.status).toBe(404);

    await CleaningStaffAttendance.destroy({ where: { id: foreignRow.id }, force: true });
    await CleaningStaff.destroy({ where: { id: foreignStaff.id }, force: true });
  });

  it("returns one staff member's attendance history", async () => {
    const staff = await makeStaff(societyId, { name: "History Viewer" });
    createdStaffIds.push(staff.id);

    const res = await request(app)
      .get(`/api/cleaning-staff/${staff.id}/attendance`)
      .set(admin.headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("Cleaning Staff — data isolation", () => {
  it("does not read from visitor_preapprovals or visitorlogs", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "controllers", "cleaningStaffControllers.js"),
      "utf8"
    );

    expect(src).not.toMatch(/VisitorPreApproval/);
    expect(src).not.toMatch(/VisitorLog/);
    expect(src).not.toMatch(/visitor_preapprovals/);
    expect(src).not.toMatch(/visitorlogs/);
  });

  it("keeps cleaning tables as the only storage", () => {
    const fs = require("fs");
    const path = require("path");
    const models = ["CleaningStaff", "CleaningStaffPass", "CleaningStaffAttendance"];

    for (const name of models) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", "models", `${name}.js`), "utf8");
      expect(src).toMatch(/tableName:\s*"cleaning_staff/);
    }
  });
});