const { Op } = require("sequelize");
const {
  User,
  UserSociety,
  UserSocietyRole,
  AccountantAssignment,
} = require("../models");

const ROLE_META = {
  SOCIETY_ADMIN: { label: "Society Admin", priority: 1 },
  CHAIRMAN: { label: "Chairman", priority: 2 },
  SECRETARY: { label: "Secretary", priority: 3 },
  TREASURER: { label: "Treasurer", priority: 4 },
  COMMITTEE_MEMBER: { label: "Committee Member", priority: 5 },
  ACCOUNTANT: { label: "Accountant", priority: 6 },
};

const MANAGEMENT_ROLE_KEYS = Object.keys(ROLE_META);

const normalizeRoleKey = (rawRole) => {
  const upper = String(rawRole || "").trim().toUpperCase();
  if (upper === "COMMITTEE") return "COMMITTEE_MEMBER";
  return ROLE_META[upper] ? upper : null;
};

const parseUserRoles = (user) => {
  let list = [];
  if (Array.isArray(user.roles)) {
    list = user.roles;
  } else if (typeof user.roles === "string") {
    try {
      const parsed = JSON.parse(user.roles);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  if (user.role) list = [...list, user.role];
  return list.map(normalizeRoleKey).filter(Boolean);
};

/**
 * GET /api/users/management-team
 * Returns active Society Admin(s), Committee Members, and Accountants (including
 * active outsider accountants) for the logged-in user's society, deduplicated
 * by user ID with safe public directory fields only.
 */
const getManagementTeam = async (req, res) => {
  try {
    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";

    const rawSocietyId = isSuperAdmin
      ? req.headers["x-society-id"] || req.query.society_id || req.user?.society_id
      : req.user?.society_id;

    const societyId = rawSocietyId && rawSocietyId !== "ALL"
      ? parseInt(rawSocietyId, 10)
      : null;

    if (!societyId || !Number.isInteger(societyId)) {
      return res.status(400).json({
        success: false,
        message: "Society context not found for this user.",
      });
    }

    const userAttributes = [
      "id",
      "name",
      "email",
      "phone",
      "role",
      "roles",
      "society_id",
      "status",
      "approval_status",
      "profile_picture",
    ];

    const [
      allSocietyMemberships,
      legacyUsers,
      accountantAssignments,
    ] = await Promise.all([
      UserSociety.findAll({
        where: { society_id: societyId },
        include: [
          {
            model: User,
            as: "user",
            required: true,
            attributes: userAttributes,
          },
          {
            model: UserSocietyRole,
            as: "societyRoles",
            required: false,
          },
        ],
      }),
      User.findAll({
        where: {
          society_id: societyId,
          status: "ACTIVE",
          approval_status: { [Op.ne]: "REJECTED" },
        },
        attributes: userAttributes,
      }),
      AccountantAssignment.findAll({
        where: { society_id: societyId },
        include: [
          {
            model: User,
            as: "user",
            required: true,
            attributes: userAttributes,
          },
        ],
      }),
    ]);

    const inactiveMembershipUserIds = new Set();
    for (const membership of allSocietyMemberships) {
      if (membership.membership_status !== "ACTIVE") {
        inactiveMembershipUserIds.add(membership.user_id);
      }
    }

    const activeAccountantUserIds = new Set();
    const inactiveAccountantUserIds = new Set();
    for (const assignment of accountantAssignments) {
      if (assignment.status === "ACTIVE") {
        activeAccountantUserIds.add(assignment.user_id);
      } else {
        inactiveAccountantUserIds.add(assignment.user_id);
      }
    }
    for (const activeId of activeAccountantUserIds) {
      inactiveAccountantUserIds.delete(activeId);
    }

    // Map<userId, { user, roleKeys: Set<string>, isOutsider: boolean }>
    const directoryMap = new Map();

    const addMemberRole = (user, roleKey, { isOutsider = false } = {}) => {
      if (!user || !roleKey || !ROLE_META[roleKey]) return;
      if (user.status !== "ACTIVE") return;
      if (user.approval_status === "REJECTED") return;

      if (!directoryMap.has(user.id)) {
        directoryMap.set(user.id, {
          user,
          roleKeys: new Set(),
          isOutsider: false,
        });
      }
      const entry = directoryMap.get(user.id);
      entry.roleKeys.add(roleKey);
      if (isOutsider) entry.isOutsider = true;
    };

    // 1. Multi-society memberships (UserSociety + UserSocietyRole)
    for (const membership of allSocietyMemberships) {
      if (membership.membership_status !== "ACTIVE") continue;
      const user = membership.user;
      if (!user || user.status !== "ACTIVE" || user.approval_status === "REJECTED") {
        continue;
      }

      const socRoles = Array.isArray(membership.societyRoles)
        ? membership.societyRoles
        : [];

      for (const sr of socRoles) {
        const key = normalizeRoleKey(sr.role);
        if (!key) continue;
        if (key === "ACCOUNTANT" && inactiveAccountantUserIds.has(user.id)) {
          continue;
        }
        addMemberRole(user, key);
      }
    }

    // 2. Legacy User.society_id + User.role / User.roles
    for (const user of legacyUsers) {
      if (inactiveMembershipUserIds.has(user.id)) continue;
      if (user.approval_status === "PENDING") continue;

      const keys = parseUserRoles(user);
      for (const key of keys) {
        if (!MANAGEMENT_ROLE_KEYS.includes(key)) continue;
        if (key === "ACCOUNTANT" && inactiveAccountantUserIds.has(user.id)) {
          continue;
        }
        addMemberRole(user, key);
      }
    }

    // 3. Active AccountantAssignments (includes outsider accountants)
    for (const assignment of accountantAssignments) {
      if (assignment.status !== "ACTIVE") continue;
      const user = assignment.user;
      if (!user || user.status !== "ACTIVE" || user.approval_status === "REJECTED") {
        continue;
      }
      addMemberRole(user, "ACCOUNTANT", {
        isOutsider: !assignment.is_society_resident && !assignment.is_from_society,
      });
    }

    const members = Array.from(directoryMap.values())
      .map(({ user, roleKeys, isOutsider }) => {
        const sortedRoleKeys = Array.from(roleKeys).sort(
          (a, b) => ROLE_META[a].priority - ROLE_META[b].priority
        );
        const primaryKey = sortedRoleKeys[0];
        const designations = sortedRoleKeys.map((k) => ROLE_META[k].label);

        return {
          id: user.id,
          name: user.name,
          email: user.email || null,
          phone: user.phone || null,
          profile_picture: user.profile_picture || null,
          designation: ROLE_META[primaryKey].label,
          designations,
          role_key: primaryKey,
          is_outsider: primaryKey === "ACCOUNTANT" ? isOutsider : false,
          _priority: ROLE_META[primaryKey].priority,
        };
      })
      .sort((a, b) => {
        if (a._priority !== b._priority) return a._priority - b._priority;
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .map(({ _priority, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      count: members.length,
      data: members,
    });
  } catch (err) {
    console.error("getManagementTeam error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch society management team.",
    });
  }
};

module.exports = {
  getManagementTeam,
};
