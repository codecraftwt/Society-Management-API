const mockFindAllUserSociety = jest.fn();
const mockFindAllUser = jest.fn();
const mockFindAllAccountantAssignment = jest.fn();

jest.mock("../models", () => ({
  User: { findAll: (...args) => mockFindAllUser(...args) },
  UserSociety: { findAll: (...args) => mockFindAllUserSociety(...args) },
  UserSocietyRole: {},
  AccountantAssignment: {
    findAll: (...args) => mockFindAllAccountantAssignment(...args),
  },
}));

const { getManagementTeam } = require("../controllers/managementTeamController");

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("getManagementTeam controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindAllUserSociety.mockResolvedValue([]);
    mockFindAllUser.mockResolvedValue([]);
    mockFindAllAccountantAssignment.mockResolvedValue([]);
  });

  it("returns 400 when user has no society_id", async () => {
    const req = { user: { id: 1, role: "RESIDENT", activeRole: "RESIDENT" }, headers: {}, query: {} };
    const res = makeRes();

    await getManagementTeam(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it("enforces society-level isolation for non-super-admin users (ignores query society_id)", async () => {
    const req = {
      user: { id: 10, role: "RESIDENT", activeRole: "RESIDENT", society_id: 5 },
      headers: { "x-society-id": "99" },
      query: { society_id: "99" },
    };
    const res = makeRes();

    await getManagementTeam(req, res);

    expect(mockFindAllUserSociety).toHaveBeenCalledWith(
      expect.objectContaining({ where: { society_id: 5 } })
    );
    expect(mockFindAllUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ society_id: 5 }) })
    );
    expect(mockFindAllAccountantAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { society_id: 5 } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns active admin, committee members, and outsider accountant without duplicates or sensitive fields", async () => {
    mockFindAllUserSociety.mockResolvedValue([
      {
        user_id: 2,
        membership_status: "ACTIVE",
        user: {
          id: 2,
          name: "Asha Mehta",
          email: "asha@soc.test",
          phone: "9876543210",
          role: "RESIDENT",
          roles: ["RESIDENT", "COMMITTEE_MEMBER"],
          status: "ACTIVE",
          approval_status: "APPROVED",
          profile_picture: "https://cdn.example.com/asha.jpg",
          password: "hashed-secret-should-not-leak",
          fcm_token: "fcm-secret",
        },
        societyRoles: [{ role: "COMMITTEE_MEMBER" }],
      },
      {
        user_id: 3,
        membership_status: "LEFT",
        user: {
          id: 3,
          name: "Left Member",
          email: "left@soc.test",
          phone: "9999999999",
          role: "COMMITTEE_MEMBER",
          roles: ["COMMITTEE_MEMBER"],
          status: "ACTIVE",
          approval_status: "APPROVED",
        },
        societyRoles: [{ role: "COMMITTEE_MEMBER" }],
      },
    ]);

    mockFindAllUser.mockResolvedValue([
      {
        id: 1,
        name: "Rohan Sharma",
        email: "admin@soc.test",
        phone: "9111111111",
        role: "SOCIETY_ADMIN",
        roles: ["SOCIETY_ADMIN", "COMMITTEE_MEMBER"],
        status: "ACTIVE",
        approval_status: "APPROVED",
        profile_picture: null,
      },
      {
        // Should be excluded because membership_status is LEFT
        id: 3,
        name: "Left Member",
        email: "left@soc.test",
        phone: "9999999999",
        role: "COMMITTEE_MEMBER",
        roles: ["COMMITTEE_MEMBER"],
        status: "ACTIVE",
        approval_status: "APPROVED",
      },
      {
        // Plain resident should not be included
        id: 4,
        name: "Regular Resident",
        email: "res@soc.test",
        phone: "9222222222",
        role: "RESIDENT",
        roles: ["RESIDENT"],
        status: "ACTIVE",
        approval_status: "APPROVED",
      },
      {
        // Legacy accountant whose assignment was deactivated -> excluded
        id: 6,
        name: "Former Accountant",
        email: "former@soc.test",
        phone: "9666666666",
        role: "ACCOUNTANT",
        roles: ["ACCOUNTANT"],
        status: "ACTIVE",
        approval_status: "APPROVED",
      },
    ]);

    mockFindAllAccountantAssignment.mockResolvedValue([
      {
        user_id: 5,
        society_id: 7,
        status: "ACTIVE",
        is_society_resident: false,
        is_from_society: false,
        user: {
          id: 5,
          name: "Vikram Patel",
          email: "vikram.ca@firm.test",
          phone: "9555555555",
          role: "ACCOUNTANT",
          roles: ["ACCOUNTANT"],
          status: "ACTIVE",
          approval_status: "APPROVED",
          profile_picture: null,
        },
      },
      {
        user_id: 6,
        society_id: 7,
        status: "INACTIVE",
        is_society_resident: false,
        is_from_society: false,
        user: {
          id: 6,
          name: "Former Accountant",
          email: "former@soc.test",
          phone: "9666666666",
          role: "ACCOUNTANT",
          roles: ["ACCOUNTANT"],
          status: "ACTIVE",
          approval_status: "APPROVED",
        },
      },
    ]);

    const req = {
      user: { id: 4, role: "RESIDENT", activeRole: "RESIDENT", society_id: 7 },
      headers: {},
      query: {},
    };
    const res = makeRes();

    await getManagementTeam(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.count).toBe(3);

    const ids = payload.data.map((m) => m.id);
    expect(ids).toEqual([1, 2, 5]); // Sorted: Society Admin (1), Committee Member (2), Accountant (5)

    // Multi-role admin should not be duplicated, and should list both designations
    expect(payload.data[0]).toEqual({
      id: 1,
      name: "Rohan Sharma",
      email: "admin@soc.test",
      phone: "9111111111",
      profile_picture: null,
      designation: "Society Admin",
      designations: ["Society Admin", "Committee Member"],
      role_key: "SOCIETY_ADMIN",
      is_outsider: false,
    });

    // Ensure sensitive fields are never exposed
    expect(payload.data[1]).not.toHaveProperty("password");
    expect(payload.data[1]).not.toHaveProperty("fcm_token");
    expect(payload.data[1].profile_picture).toBe("https://cdn.example.com/asha.jpg");

    // Outsider accountant flagged properly
    expect(payload.data[2]).toEqual({
      id: 5,
      name: "Vikram Patel",
      email: "vikram.ca@firm.test",
      phone: "9555555555",
      profile_picture: null,
      designation: "Accountant",
      designations: ["Accountant"],
      role_key: "ACCOUNTANT",
      is_outsider: true,
    });
  });

  it("allows SUPER_ADMIN to scope by x-society-id header", async () => {
    const req = {
      user: { id: 1, role: "SUPER_ADMIN", activeRole: "SUPER_ADMIN", society_id: null },
      headers: { "x-society-id": "12" },
      query: {},
    };
    const res = makeRes();

    await getManagementTeam(req, res);

    expect(mockFindAllUserSociety).toHaveBeenCalledWith(
      expect.objectContaining({ where: { society_id: 12 } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
