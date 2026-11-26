const mockTx = {
  commit: jest.fn(),
  rollback: jest.fn(),
};

const mockModels = {
  sequelize: {
    transaction: jest.fn(async () => mockTx),
    fn: jest.fn((name, col) => `${name}(${col})`),
    col: jest.fn((c) => c),
  },
  MeetingCategory: {
    count: jest.fn(),
    findOrCreate: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  MeetingMinutes: {
    count: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  MeetingAttendee: {
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
  },
  User: { findAll: jest.fn() },
  UserSociety: { findAll: jest.fn() },
  UserSocietyRole: {},
  AccountantAssignment: { findAll: jest.fn() },
  FlatMembership: { findAll: jest.fn() },
  Flat: { findAll: jest.fn() },
  Floor: {},
  Block: {},
  HouseHoldMember: { findAll: jest.fn() },
  ResidentHistory: { findAll: jest.fn() },
  RolePermission: { findAll: jest.fn() },
};

jest.mock("../models", () => mockModels);

const categoryCtrl = require("../controllers/meetingCategoryController");
const momCtrl = require("../controllers/meetingMinutesController");
const { checkPermission } = require("../middlewares/permissionMiddleware");

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("Meeting Minutes (MOM) API Controllers & RBAC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModels.UserSociety.findAll.mockResolvedValue([]);
    mockModels.AccountantAssignment.findAll.mockResolvedValue([]);
    mockModels.FlatMembership.findAll.mockResolvedValue([]);
    mockModels.Flat.findAll.mockResolvedValue([]);
    mockModels.HouseHoldMember.findAll.mockResolvedValue([]);
    mockModels.ResidentHistory.findAll.mockResolvedValue([]);
    mockModels.User.findAll.mockResolvedValue([]);
    mockModels.RolePermission.findAll.mockResolvedValue([]);
  });

  describe("Category Management", () => {
    it("auto-seeds default categories when society has none and returns usage counts", async () => {
      mockModels.MeetingCategory.count.mockResolvedValue(0);
      mockModels.MeetingCategory.findOrCreate.mockResolvedValue([{}, true]);
      mockModels.MeetingCategory.findAll.mockResolvedValue([
        { toJSON: () => ({ id: 1, society_id: 5, name: "Committee Meeting", is_active: true }) },
      ]);
      mockModels.MeetingMinutes.findAll = jest.fn().mockResolvedValue([
        { category_id: 1, cnt: 3 },
      ]);

      const req = { user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 }, query: {}, headers: {} };
      const res = makeRes();

      await categoryCtrl.listCategories(req, res);

      expect(mockModels.MeetingCategory.findOrCreate).toHaveBeenCalledTimes(4);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 1, society_id: 5, name: "Committee Meeting", is_active: true, usage_count: 3 }],
      });
    });

    it("rejects duplicate category names within the same society (409)", async () => {
      mockModels.MeetingCategory.findOne.mockResolvedValue({ id: 2, name: "AGM" });

      const req = {
        user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 },
        body: { name: "AGM" },
        headers: {},
        query: {},
      };
      const res = makeRes();

      await categoryCtrl.createCategory(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it("deactivates category instead of deleting if used by meetings", async () => {
      const mockCat = { id: 10, update: jest.fn(), destroy: jest.fn() };
      mockModels.MeetingCategory.findOne.mockResolvedValue(mockCat);
      mockModels.MeetingMinutes.count.mockResolvedValue(2);

      const req = {
        user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 },
        params: { id: "10" },
        headers: {},
        query: {},
      };
      const res = makeRes();

      await categoryCtrl.deleteCategory(req, res);

      expect(mockCat.update).toHaveBeenCalledWith({ is_active: false });
      expect(mockCat.destroy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, deactivated: true })
      );
    });
  });

  describe("Meeting CRUD & Attendance Validation", () => {
    it("creates a meeting with deduplicated attendees and snapshots inside a transaction", async () => {
      mockModels.MeetingCategory.findOne.mockResolvedValue({ id: 1, society_id: 5, is_active: true });
      mockModels.User.findAll.mockResolvedValue([
        {
          id: 11,
          name: "Amit Sharma",
          email: "amit@soc.test",
          phone: "9999999999",
          role: "RESIDENT",
          roles: ["RESIDENT"],
          society_id: 5,
          status: "ACTIVE",
          approval_status: "APPROVED",
          resident_type: "OWNER",
        },
      ]);
      mockModels.MeetingMinutes.create.mockResolvedValue({ id: 101, meeting_title: "Monthly Meet" });
      mockModels.MeetingAttendee.bulkCreate.mockResolvedValue([]);

      const req = {
        user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 },
        headers: {},
        query: {},
        body: {
          meeting_title: "Monthly Meet",
          category_id: 1,
          meeting_date: "2026-11-26",
          agenda: "Discuss solar & security",
          minutes: "Approved solar vendor quote.",
          attendees: [
            { user_id: 11, attendance_status: "ABSENT" },
            { user_id: 11, attendance_status: "PRESENT" }, // duplicate should deduplicate to PRESENT
          ],
        },
      };
      const res = makeRes();

      await momCtrl.createMeeting(req, res);

      expect(mockTx.commit).toHaveBeenCalled();
      expect(mockModels.MeetingAttendee.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            meeting_id: 101,
            society_id: 5,
            user_id: 11,
            attendance_status: "PRESENT",
            member_name_snapshot: "Amit Sharma",
            member_role_snapshot: "Owner",
          }),
        ],
        { transaction: mockTx }
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("rejects cross-society or ineligible user IDs in attendance and rolls back", async () => {
      mockModels.MeetingCategory.findOne.mockResolvedValue({ id: 1, society_id: 5, is_active: true });
      mockModels.User.findAll.mockResolvedValue([]); // user 999 not in society 5

      const req = {
        user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 },
        headers: {},
        query: {},
        body: {
          meeting_title: "Monthly Meet",
          category_id: 1,
          meeting_date: "2026-11-26",
          agenda: "Agenda",
          minutes: "Minutes",
          attendees: [{ user_id: 999, attendance_status: "PRESENT" }],
        },
      };
      const res = makeRes();

      await momCtrl.createMeeting(req, res);

      expect(mockTx.rollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("preserves historical attendees when editing a meeting even if user is no longer active", async () => {
      const mockMeeting = {
        id: 101,
        society_id: 5,
        meeting_title: "Old Meet",
        category_id: 1,
        meeting_date: "2026-10-01",
        agenda: "Old agenda",
        minutes: "Old minutes",
        decisions: null,
        update: jest.fn(),
      };
      mockModels.MeetingMinutes.findOne.mockResolvedValue(mockMeeting);
      mockModels.MeetingCategory.findOne.mockResolvedValue({ id: 1, society_id: 5 });

      const existingAttendee = {
        id: 50,
        meeting_id: 101,
        user_id: 77,
        attendance_status: "ABSENT",
        member_name_snapshot: "Former Resident",
        update: jest.fn(),
      };
      mockModels.MeetingAttendee.findAll.mockResolvedValue([existingAttendee]);

      const req = {
        user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 },
        params: { id: "101" },
        headers: {},
        query: {},
        body: {
          meeting_title: "Updated Meet",
          attendees: [{ user_id: 77, attendance_status: "PRESENT" }],
        },
      };
      const res = makeRes();

      await momCtrl.updateMeeting(req, res);

      expect(existingAttendee.update).toHaveBeenCalledWith(
        { attendance_status: "PRESENT" },
        { transaction: mockTx }
      );
      expect(mockTx.commit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it("computes present/absent/total dynamically in listMeetings", async () => {
      mockModels.MeetingMinutes.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [{ id: 10, toJSON: () => ({ id: 10, meeting_title: "AGM 2026" }) }],
      });
      mockModels.MeetingAttendee.findAll.mockResolvedValue([
        { meeting_id: 10, attendance_status: "PRESENT", cnt: 8 },
        { meeting_id: 10, attendance_status: "ABSENT", cnt: 2 },
      ]);

      const req = { user: { id: 1, role: "SOCIETY_ADMIN", society_id: 5 }, query: {}, headers: {} };
      const res = makeRes();

      await momCtrl.listMeetings(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          total: 1,
          data: [
            expect.objectContaining({
              id: 10,
              total_attendees: 10,
              present_count: 8,
              absent_count: 2,
            }),
          ],
        })
      );
    });
  });

  describe("RBAC Enforcement", () => {
    it("blocks RESIDENT from meeting_minutes admin actions", async () => {
      const mw = checkPermission("meeting_minutes", "view");
      const req = { user: { id: 2, role: "RESIDENT", roles: ["RESIDENT"], activeRole: "RESIDENT", society_id: 5 } };
      const res = makeRes();
      const next = jest.fn();

      await mw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("allows COMMITTEE_MEMBER and respects ACCOUNTANT dynamic overrides", async () => {
      const mw = checkPermission("meeting_minutes", "create");
      const next = jest.fn();

      await mw(
        { user: { id: 3, role: "COMMITTEE_MEMBER", roles: ["COMMITTEE_MEMBER"], activeRole: "COMMITTEE_MEMBER", society_id: 5 } },
        makeRes(),
        next
      );
      expect(next).toHaveBeenCalledTimes(1);

      const accRes = makeRes();
      const accNext = jest.fn();
      await mw(
        { user: { id: 4, role: "ACCOUNTANT", roles: ["ACCOUNTANT"], activeRole: "ACCOUNTANT", society_id: 5 } },
        accRes,
        accNext
      );
      expect(accNext).not.toHaveBeenCalled();
      expect(accRes.status).toHaveBeenCalledWith(403);
    });
  });
});
