const { Op } = require("sequelize");
const {
  sequelize,
  MeetingMinutes,
  MeetingCategory,
  MeetingAttendee,
  User,
  UserSociety,
  UserSocietyRole,
  AccountantAssignment,
  FlatMembership,
  Flat,
  Floor,
  Block,
  HouseHoldMember,
  ResidentHistory,
} = require("../models");

const ELIGIBLE_ROLE_KEYS = new Set([
  "RESIDENT",
  "SOCIETY_ADMIN",
  "COMMITTEE_MEMBER",
  "ACCOUNTANT",
  "FAMILY_MEMBER",
  "TENANT",
  "OWNER",
]);

function resolveSocietyId(req) {
  const isSuperAdmin =
    req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  if (isSuperAdmin) {
    const raw =
      req.headers["x-society-id"] ||
      req.query.society_id ||
      req.body?.society_id ||
      req.user?.society_id;
    const parsed = raw && raw !== "ALL" ? parseInt(raw, 10) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return req.user?.society_id || null;
}

function parseRolesArray(user) {
  let rList = [];
  if (Array.isArray(user.roles)) {
    rList = [...user.roles];
  } else if (typeof user.roles === "string") {
    try {
      const parsed = JSON.parse(user.roles);
      if (Array.isArray(parsed)) rList = parsed;
    } catch {
      rList = [];
    }
  }
  if (user.role && !rList.includes(user.role)) rList.push(user.role);
  return rList.map((r) => String(r).toUpperCase());
}

function formatFlatLabel(flat) {
  if (!flat) return null;
  const blockName = flat.Floor?.Block?.name || flat.Block?.name || null;
  const num = flat.flat_number || "";
  if (blockName && num) return `${blockName}-${num}`;
  return num || blockName || null;
}

function formatPrimaryRoleLabel(roles, { isOwner, isTenant, isFamily }) {
  if (roles.includes("SOCIETY_ADMIN")) return "Society Admin";
  if (roles.includes("COMMITTEE_MEMBER")) return "Committee Member";
  if (roles.includes("ACCOUNTANT")) return "Accountant";
  if (isOwner) return "Owner";
  if (isTenant) return "Tenant";
  if (isFamily) return "Family Member";
  return "Resident";
}

/**
 * Resolves all active, approved, society-scoped eligible members for a society,
 * reusing the same society/flat/role resolution logic as GET /api/users/resident.
 */
async function resolveEligibleMembersForSociety(
  societyId,
  { search = "", role = "", block_id = "", floor_id = "", flat_id = "" } = {}
) {
  // 1. Pre-resolve flat/block matches if search or block/floor/flat filters exist
  let matchingUserIdsFromFlats = [];
  if (search) {
    const searchTrim = search.trim();
    const digitMatch = searchTrim.match(/\d+/);
    const digitStr = digitMatch ? digitMatch[0] : null;
    const flatSearchConditions = [{ flat_number: { [Op.like]: `%${searchTrim}%` } }];
    if (digitStr && digitStr !== searchTrim) {
      flatSearchConditions.push({ flat_number: { [Op.like]: `%${digitStr}%` } });
    }

    const matchedFlats = await Flat.findAll({
      where: { [Op.or]: flatSearchConditions },
      attributes: ["id", "flat_number", "resident_id", "block_id"],
      include: [
        { model: Block, attributes: ["id", "name", "society_id"], required: false },
        {
          model: Floor,
          attributes: ["id"],
          required: false,
          include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
        },
      ],
    });

    const relevantFlats = matchedFlats.filter((f) => {
      const sId = f.Block?.society_id || f.Floor?.Block?.society_id;
      return Number(sId) === Number(societyId);
    });
    const matchedFlatIds = [...new Set(relevantFlats.map((f) => f.id))];
    relevantFlats.forEach((f) => {
      if (f.resident_id) matchingUserIdsFromFlats.push(f.resident_id);
    });

    if (matchedFlatIds.length > 0) {
      const [mems, household] = await Promise.all([
        FlatMembership.findAll({
          where: { flat_id: { [Op.in]: matchedFlatIds }, is_current: true },
          attributes: ["user_id"],
        }),
        HouseHoldMember.findAll({
          where: { flat_id: { [Op.in]: matchedFlatIds } },
          attributes: ["user_id"],
        }),
      ]);
      mems.forEach((m) => m.user_id && matchingUserIdsFromFlats.push(m.user_id));
      household.forEach((h) => h.user_id && matchingUserIdsFromFlats.push(h.user_id));
    }
    matchingUserIdsFromFlats = [...new Set(matchingUserIdsFromFlats.filter(Boolean))];
  }

  // 2. Gather society memberships + active accountants + current tenants
  const [userSocieties, activeAccountants, tenantMemberships] = await Promise.all([
    UserSociety.findAll({
      where: { society_id: societyId },
      attributes: ["id", "user_id", "membership_status"],
      include: [
        {
          model: UserSocietyRole,
          as: "societyRoles",
          attributes: ["role"],
          required: false,
        },
      ],
    }),
    AccountantAssignment.findAll({
      where: { society_id: societyId, status: "ACTIVE" },
      attributes: ["user_id", "is_society_resident"],
    }),
    FlatMembership.findAll({
      where: { role: "TENANT", is_current: true },
      attributes: ["user_id"],
      include: [
        {
          model: Flat,
          attributes: ["id"],
          required: true,
          include: [
            { model: Block, attributes: ["society_id"], required: false },
            {
              model: Floor,
              attributes: ["id"],
              required: false,
              include: [{ model: Block, attributes: ["society_id"], required: false }],
            },
          ],
        },
      ],
    }),
  ]);

  const inactiveSocietyUserIds = new Set();
  const activeSocietyUserIds = new Set();
  const societyRolesByUser = new Map();

  for (const us of userSocieties) {
    if (us.membership_status !== "ACTIVE") {
      inactiveSocietyUserIds.add(us.user_id);
      continue;
    }
    activeSocietyUserIds.add(us.user_id);
    const roles = (us.societyRoles || []).map((r) => String(r.role).toUpperCase());
    societyRolesByUser.set(us.user_id, roles);
  }

  for (const acc of activeAccountants) {
    activeSocietyUserIds.add(acc.user_id);
    const roles = societyRolesByUser.get(acc.user_id) || [];
    if (!roles.includes("ACCOUNTANT")) roles.push("ACCOUNTANT");
    societyRolesByUser.set(acc.user_id, roles);
  }

  for (const tm of tenantMemberships) {
    const sId = tm.Flat?.Block?.society_id || tm.Flat?.Floor?.Block?.society_id;
    if (Number(sId) === Number(societyId) && tm.user_id) {
      activeSocietyUserIds.add(tm.user_id);
    }
  }

  const memberIds = Array.from(activeSocietyUserIds);

  const conditions = [
    { status: "ACTIVE" },
    { approval_status: { [Op.ne]: "REJECTED" } },
    {
      [Op.or]: [
        { society_id: societyId },
        ...(memberIds.length > 0 ? [{ id: { [Op.in]: memberIds } }] : []),
      ],
    },
  ];

  if (search) {
    const searchTrim = search.trim();
    const searchOr = [
      { name: { [Op.like]: `%${searchTrim}%` } },
      { email: { [Op.like]: `%${searchTrim}%` } },
      { phone: { [Op.like]: `%${searchTrim}%` } },
    ];
    if (matchingUserIdsFromFlats.length > 0) {
      searchOr.push({ id: { [Op.in]: matchingUserIdsFromFlats } });
    }
    conditions.push({ [Op.or]: searchOr });
  }

  const users = await User.findAll({
    where: { [Op.and]: conditions },
    attributes: [
      "id",
      "name",
      "email",
      "phone",
      "role",
      "roles",
      "society_id",
      "status",
      "approval_status",
      "resident_type",
      "profile_picture",
    ],
    order: [["name", "ASC"]],
  });

  // Filter out pending legacy users, left/suspended memberships, SUPER_ADMIN, and non-resident GUARDs
  const eligibleUsers = users.filter((u) => {
    if (inactiveSocietyUserIds.has(u.id) && !activeAccountants.some((a) => a.user_id === u.id)) {
      return false;
    }
    if (u.approval_status === "PENDING" && !activeSocietyUserIds.has(u.id)) {
      return false;
    }
    const baseRoles = parseRolesArray(u);
    const socRoles = societyRolesByUser.get(u.id) || [];
    const combined = [...new Set([...baseRoles, ...socRoles])];

    if (combined.includes("SUPER_ADMIN") && !socRoles.some((r) => ELIGIBLE_ROLE_KEYS.has(r))) {
      return false;
    }
    return combined.some((r) => ELIGIBLE_ROLE_KEYS.has(r));
  });

  const userIds = eligibleUsers.map((u) => u.id);
  if (userIds.length === 0) return [];

  const [allMembershipsRaw, directFlatsRaw, householdMemberships, residentHistories] =
    await Promise.all([
      FlatMembership.findAll({
        where: { user_id: { [Op.in]: userIds }, is_current: true },
        include: [
          {
            model: Flat,
            attributes: ["id", "flat_number", "flat_type", "floor_id", "occupancy_status", "resident_id"],
            include: [
              {
                model: Floor,
                attributes: ["id", "floor_number"],
                required: false,
                include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
              },
              { model: Block, attributes: ["id", "name", "society_id"], required: false },
            ],
          },
        ],
      }),
      Flat.findAll({
        where: { resident_id: { [Op.in]: userIds }, occupancy_status: { [Op.ne]: "VACANT" } },
        attributes: ["id", "flat_number", "flat_type", "floor_id", "occupancy_status", "resident_id"],
        include: [
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
          },
          { model: Block, attributes: ["id", "name", "society_id"], required: false },
        ],
      }),
      HouseHoldMember.findAll({
        where: { user_id: { [Op.in]: userIds } },
        attributes: ["id", "flat_id", "user_id", "relation"],
        include: [
          {
            model: Flat,
            attributes: ["id", "flat_number", "flat_type", "floor_id", "occupancy_status", "resident_id"],
            include: [
              {
                model: Floor,
                attributes: ["id", "floor_number"],
                required: false,
                include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
              },
              { model: Block, attributes: ["id", "name", "society_id"], required: false },
            ],
          },
        ],
      }),
      ResidentHistory.findAll({
        where: { user_id: { [Op.in]: userIds } },
        attributes: ["user_id", "flat_id", "is_current", "move_out_date"],
      }),
    ]);

  // Reconcile stale FlatMemberships against ResidentHistory & VACANT flats (matching getResidents)
  const allMemberships = allMembershipsRaw.filter((m) => {
    if (!m.flat_id || !m.Flat) return false;
    const flatSocId = m.Flat.Floor?.Block?.society_id || m.Flat.Block?.society_id;
    if (Number(flatSocId) !== Number(societyId)) return false;

    const userHistForFlat = residentHistories.filter(
      (h) => Number(h.flat_id) === Number(m.flat_id) && Number(h.user_id) === Number(m.user_id)
    );
    const hasCurrentHistory = userHistForFlat.some((h) => h.is_current);
    const hasPastHistory = userHistForFlat.some((h) => !h.is_current && h.move_out_date);
    const flatVacantNotResident =
      m.Flat.occupancy_status === "VACANT" && Number(m.Flat.resident_id) !== Number(m.user_id);

    return !((hasPastHistory && !hasCurrentHistory) || flatVacantNotResident);
  });

  const directFlats = directFlatsRaw.filter((f) => {
    const flatSocId = f.Floor?.Block?.society_id || f.Block?.society_id;
    return Number(flatSocId) === Number(societyId);
  });

  // Build normalized member records
  let formatted = eligibleUsers.map((u) => {
    const userMems = allMemberships.filter((m) => m.user_id === u.id);
    const userDirect = directFlats.filter((f) => f.resident_id === u.id);
    const userHouseholds = householdMemberships.filter((h) => {
      if (h.user_id !== u.id || !h.Flat) return false;
      const flatSocId = h.Flat.Floor?.Block?.society_id || h.Flat.Block?.society_id;
      return Number(flatSocId) === Number(societyId);
    });

    const flatMap = new Map();
    userMems.forEach((m) => m.Flat && flatMap.set(m.Flat.id, m.Flat));
    userDirect.forEach((f) => flatMap.set(f.id, f));
    userHouseholds.forEach((h) => h.Flat && flatMap.set(h.Flat.id, h.Flat));

    const flats = Array.from(flatMap.values());
    const flatLabels = flats.map(formatFlatLabel).filter(Boolean);

    const baseRoles = parseRolesArray(u);
    const socRoles = societyRolesByUser.get(u.id) || [];
    const rList = [...new Set([...baseRoles, ...socRoles])];

    const isOwner =
      String(u.resident_type || "").toUpperCase() === "OWNER" ||
      userMems.some((m) => String(m.role || "").toUpperCase() === "OWNER") ||
      userDirect.length > 0;

    const isTenant =
      !isOwner &&
      (rList.includes("TENANT") ||
        String(u.resident_type || "").toUpperCase() === "TENANT" ||
        userMems.some((m) => String(m.role || "").toUpperCase() === "TENANT"));

    const isFamily =
      !isOwner &&
      !isTenant &&
      (u.role === "FAMILY_MEMBER" ||
        rList.includes("FAMILY_MEMBER") ||
        String(u.resident_type || "").toUpperCase() === "FAMILY_MEMBER" ||
        userHouseholds.length > 0);

    return {
      id: u.id,
      name: u.name,
      email: u.email || null,
      phone: u.phone || null,
      profile_picture: u.profile_picture || null,
      role: u.role,
      roles: rList,
      primary_role_label: formatPrimaryRoleLabel(rList, { isOwner, isTenant, isFamily }),
      flat_info: flatLabels.join(", ") || null,
      _flats: flats,
      _isOwner: isOwner,
      _isTenant: isTenant,
      _isFamily: isFamily,
    };
  });

  // Apply Block / Floor / Flat filters
  if (block_id || floor_id || flat_id) {
    formatted = formatted.filter((m) =>
      m._flats.some((f) => {
        const fBlockId = f.Floor?.Block?.id || f.Block?.id;
        if (block_id && String(fBlockId) !== String(block_id)) return false;
        if (floor_id && String(f.floor_id) !== String(floor_id)) return false;
        if (flat_id && String(f.id) !== String(flat_id)) return false;
        return true;
      })
    );
  }

  // Apply Role Filter (mirrors GET /api/users/resident switch logic)
  if (role) {
    const targetRole = String(role).trim().toUpperCase();
    formatted = formatted.filter((m) => {
      switch (targetRole) {
        case "COMMITTEE_MEMBER":
          return m.roles.includes("COMMITTEE_MEMBER");
        case "ACCOUNTANT":
          return m.roles.includes("ACCOUNTANT");
        case "SOCIETY_ADMIN":
          return m.roles.includes("SOCIETY_ADMIN");
        case "FAMILY_MEMBER":
          return m._isFamily;
        case "TENANT":
          return m._isTenant;
        case "RESIDENT":
          if (m.roles.includes("COMMITTEE_MEMBER") || m.roles.includes("ACCOUNTANT")) return false;
          if (m._isFamily) return false;
          return m._isOwner || (!m._isTenant && m.roles.includes("RESIDENT"));
        default:
          return m.roles.includes(targetRole);
      }
    });
  }

  return formatted.map(({ _flats, _isOwner, _isTenant, _isFamily, ...clean }) => clean);
}

const getEligibleMembers = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const allEligible = await resolveEligibleMembersForSociety(societyId, {
      search: req.query.search || "",
      role: req.query.role || "",
      block_id: req.query.block_id || "",
      floor_id: req.query.floor_id || "",
      flat_id: req.query.flat_id || "",
    });

    const total = allEligible.length;
    const data = allEligible.slice(offset, offset + limit);

    return res.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("[meetingMinutesController.getEligibleMembers]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch eligible members." });
  }
};

const listMeetings = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const where = { society_id: societyId };
    if (req.query.category_id && /^\d+$/.test(String(req.query.category_id))) {
      where.category_id = parseInt(req.query.category_id, 10);
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      where[Op.or] = [
        { meeting_title: { [Op.like]: `%${q}%` } },
        { agenda: { [Op.like]: `%${q}%` } },
      ];
    }
    if (req.query.from_date || req.query.to_date) {
      where.meeting_date = {};
      if (req.query.from_date) where.meeting_date[Op.gte] = req.query.from_date;
      if (req.query.to_date) where.meeting_date[Op.lte] = req.query.to_date;
    }

    const { count, rows } = await MeetingMinutes.findAndCountAll({
      where,
      include: [
        { model: MeetingCategory, as: "category", attributes: ["id", "name", "is_active"] },
        { model: User, as: "creator", attributes: ["id", "name"], required: false },
      ],
      order: [
        ["meeting_date", "DESC"],
        ["id", "DESC"],
      ],
      limit,
      offset,
    });

    const meetingIds = rows.map((r) => r.id);
    const attendanceCounts = meetingIds.length
      ? await MeetingAttendee.findAll({
          where: { meeting_id: { [Op.in]: meetingIds } },
          attributes: [
            "meeting_id",
            "attendance_status",
            [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
          ],
          group: ["meeting_id", "attendance_status"],
          raw: true,
        })
      : [];

    const summaryMap = new Map();
    for (const row of attendanceCounts) {
      const mId = Number(row.meeting_id);
      if (!summaryMap.has(mId)) {
        summaryMap.set(mId, { total_attendees: 0, present_count: 0, absent_count: 0 });
      }
      const entry = summaryMap.get(mId);
      const cnt = Number(row.cnt || 0);
      entry.total_attendees += cnt;
      if (row.attendance_status === "PRESENT") entry.present_count += cnt;
      else entry.absent_count += cnt;
    }

    const data = rows.map((m) => {
      const counts = summaryMap.get(m.id) || {
        total_attendees: 0,
        present_count: 0,
        absent_count: 0,
      };
      return {
        ...m.toJSON(),
        ...counts,
      };
    });

    return res.json({
      success: true,
      data,
      total: count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    });
  } catch (err) {
    console.error("[meetingMinutesController.listMeetings]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch meeting minutes." });
  }
};

const getMeetingById = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const meeting = await MeetingMinutes.findOne({
      where: { id: req.params.id, society_id: societyId },
      include: [
        { model: MeetingCategory, as: "category", attributes: ["id", "name", "is_active"] },
        { model: User, as: "creator", attributes: ["id", "name"], required: false },
        { model: User, as: "updater", attributes: ["id", "name"], required: false },
        {
          model: MeetingAttendee,
          as: "attendees",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "profile_picture", "status"],
              required: false,
            },
          ],
        },
      ],
      order: [[{ model: MeetingAttendee, as: "attendees" }, "member_name_snapshot", "ASC"]],
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting record not found." });
    }

    const json = meeting.toJSON();
    const attendees = Array.isArray(json.attendees) ? json.attendees : [];
    const present_count = attendees.filter((a) => a.attendance_status === "PRESENT").length;
    const absent_count = attendees.filter((a) => a.attendance_status === "ABSENT").length;

    return res.json({
      success: true,
      data: {
        ...json,
        total_attendees: attendees.length,
        present_count,
        absent_count,
      },
    });
  } catch (err) {
    console.error("[meetingMinutesController.getMeetingById]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch meeting details." });
  }
};

function validateMeetingPayload(body) {
  const meeting_title = String(body.meeting_title || "").trim();
  const category_id = parseInt(body.category_id, 10);
  const meeting_date = String(body.meeting_date || "").trim();
  const agenda = String(body.agenda || "").trim();
  const minutes = String(body.minutes || "").trim();
  const decisions = body.decisions != null ? String(body.decisions).trim() : null;

  if (!meeting_title || meeting_title.length < 3 || meeting_title.length > 255) {
    return { error: "Meeting title must be between 3 and 255 characters." };
  }
  if (!Number.isInteger(category_id) || category_id <= 0) {
    return { error: "Valid meeting category is required." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meeting_date)) {
    return { error: "Meeting date must be in YYYY-MM-DD format." };
  }
  if (!agenda) {
    return { error: "Meeting agenda is required." };
  }
  if (!minutes) {
    return { error: "Meeting minutes are required." };
  }

  return {
    data: {
      meeting_title,
      category_id,
      meeting_date,
      agenda,
      minutes,
      decisions: decisions || null,
    },
  };
}

function normalizeAttendeesInput(rawAttendees) {
  if (!Array.isArray(rawAttendees)) return [];
  const map = new Map();
  for (const item of rawAttendees) {
    const userId = parseInt(item?.user_id, 10);
    if (!Number.isInteger(userId) || userId <= 0) continue;
    const status = String(item?.attendance_status || "ABSENT").toUpperCase();
    map.set(userId, status === "PRESENT" ? "PRESENT" : "ABSENT");
  }
  return Array.from(map.entries()).map(([user_id, attendance_status]) => ({
    user_id,
    attendance_status,
  }));
}

const createMeeting = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const parsed = validateMeetingPayload(req.body);
    if (parsed.error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const category = await MeetingCategory.findOne({
      where: { id: parsed.data.category_id, society_id: societyId, is_active: true },
      transaction: t,
    });
    if (!category) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected meeting category does not exist or is inactive for this society.",
      });
    }

    const attendeesInput = normalizeAttendeesInput(req.body.attendees);
    let attendeeRows = [];

    if (attendeesInput.length > 0) {
      const eligibleMembers = await resolveEligibleMembersForSociety(societyId);
      const eligibleMap = new Map(eligibleMembers.map((m) => [m.id, m]));

      const invalidIds = attendeesInput
        .filter((a) => !eligibleMap.has(a.user_id))
        .map((a) => a.user_id);

      if (invalidIds.length > 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `One or more selected attendees are not active eligible members of this society (IDs: ${invalidIds.join(", ")}).`,
        });
      }

      attendeeRows = attendeesInput.map((a) => {
        const member = eligibleMap.get(a.user_id);
        return {
          user_id: a.user_id,
          attendance_status: a.attendance_status,
          member_name_snapshot: member.name,
          member_role_snapshot: member.primary_role_label,
          flat_info_snapshot: member.flat_info,
        };
      });
    }

    const meeting = await MeetingMinutes.create(
      {
        ...parsed.data,
        society_id: societyId,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null,
      },
      { transaction: t }
    );

    if (attendeeRows.length > 0) {
      await MeetingAttendee.bulkCreate(
        attendeeRows.map((row) => ({
          ...row,
          meeting_id: meeting.id,
          society_id: societyId,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    return res.status(201).json({
      success: true,
      data: meeting,
      message: "Meeting minutes created successfully.",
    });
  } catch (err) {
    await t.rollback();
    console.error("[meetingMinutesController.createMeeting]", err);
    return res.status(500).json({ success: false, message: "Failed to create meeting minutes." });
  }
};

const updateMeeting = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const meeting = await MeetingMinutes.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
    });
    if (!meeting) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Meeting record not found." });
    }

    const parsed = validateMeetingPayload({
      meeting_title: req.body.meeting_title ?? meeting.meeting_title,
      category_id: req.body.category_id ?? meeting.category_id,
      meeting_date: req.body.meeting_date ?? meeting.meeting_date,
      agenda: req.body.agenda ?? meeting.agenda,
      minutes: req.body.minutes ?? meeting.minutes,
      decisions: req.body.decisions !== undefined ? req.body.decisions : meeting.decisions,
    });
    if (parsed.error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const category = await MeetingCategory.findOne({
      where: { id: parsed.data.category_id, society_id: societyId },
      transaction: t,
    });
    if (!category) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected meeting category does not belong to this society.",
      });
    }

    await meeting.update(
      {
        ...parsed.data,
        updated_by: req.user?.id || null,
      },
      { transaction: t }
    );

    if (Array.isArray(req.body.attendees)) {
      const attendeesInput = normalizeAttendeesInput(req.body.attendees);
      const existingRows = await MeetingAttendee.findAll({
        where: { meeting_id: meeting.id, society_id: societyId },
        transaction: t,
      });
      const existingMap = new Map(
        existingRows.filter((r) => r.user_id != null).map((r) => [r.user_id, r])
      );

      // Only validate *newly added* user IDs against currently eligible members;
      // existing historical attendees retain their snapshots even if inactive/left.
      const newIds = attendeesInput
        .filter((a) => !existingMap.has(a.user_id))
        .map((a) => a.user_id);

      let eligibleMap = new Map();
      if (newIds.length > 0) {
        const eligibleMembers = await resolveEligibleMembersForSociety(societyId);
        eligibleMap = new Map(eligibleMembers.map((m) => [m.id, m]));
        const invalidIds = newIds.filter((id) => !eligibleMap.has(id));
        if (invalidIds.length > 0) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `One or more newly added attendees are not active eligible members of this society (IDs: ${invalidIds.join(", ")}).`,
          });
        }
      }

      const incomingUserIdSet = new Set(attendeesInput.map((a) => a.user_id));

      // Remove attendees deselected during edit
      const idsToDelete = existingRows
        .filter((r) => r.user_id != null && !incomingUserIdSet.has(r.user_id))
        .map((r) => r.id);
      if (idsToDelete.length > 0) {
        await MeetingAttendee.destroy({
          where: { id: { [Op.in]: idsToDelete } },
          transaction: t,
        });
      }

      // Update status on existing attendees (preserving historical snapshots) and insert new ones
      const toInsert = [];
      for (const item of attendeesInput) {
        const existing = existingMap.get(item.user_id);
        if (existing) {
          if (existing.attendance_status !== item.attendance_status) {
            await existing.update({ attendance_status: item.attendance_status }, { transaction: t });
          }
        } else {
          const member = eligibleMap.get(item.user_id);
          toInsert.push({
            meeting_id: meeting.id,
            society_id: societyId,
            user_id: item.user_id,
            attendance_status: item.attendance_status,
            member_name_snapshot: member.name,
            member_role_snapshot: member.primary_role_label,
            flat_info_snapshot: member.flat_info,
          });
        }
      }

      if (toInsert.length > 0) {
        await MeetingAttendee.bulkCreate(toInsert, { transaction: t });
      }
    }

    await t.commit();
    return res.json({
      success: true,
      data: meeting,
      message: "Meeting minutes updated successfully.",
    });
  } catch (err) {
    await t.rollback();
    console.error("[meetingMinutesController.updateMeeting]", err);
    return res.status(500).json({ success: false, message: "Failed to update meeting minutes." });
  }
};

const deleteMeeting = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const meeting = await MeetingMinutes.findOne({
      where: { id: req.params.id, society_id: societyId },
    });
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting record not found." });
    }

    await meeting.destroy();
    return res.json({
      success: true,
      message: "Meeting record deleted successfully.",
    });
  } catch (err) {
    console.error("[meetingMinutesController.deleteMeeting]", err);
    return res.status(500).json({ success: false, message: "Failed to delete meeting record." });
  }
};

module.exports = {
  getEligibleMembers,
  listMeetings,
  getMeetingById,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  resolveEligibleMembersForSociety,
};
