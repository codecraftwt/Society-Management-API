/**
 * Socket.IO handshake authentication.
 *
 * The HTTP API is protected by `middlewares/authMiddleware.js`, but the socket
 * server accepted anonymous connections and trusted whatever `userId` / `role` /
 * `societyId` the client sent in its `join` payload. Any client could join
 * `user_<victimId>` or `society_<anyId>` and receive another user's private
 * notifications and every society-wide broadcast.
 *
 * This module closes that hole. The token presented in the handshake is
 * verified and the caller's identity plus the society/role grants they
 * actually hold are resolved from the database. The result is stored on
 * `socket.data.user`, and the `join` handler in server.js derives the rooms
 * from that server-side state — the client can only *ask* for a role/society,
 * never assert one.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");

const COMMITTEE_ROLE = "COMMITTEE_MEMBER";

const normaliseRole = (role) => {
  const upper = String(role || "").toUpperCase();
  return upper === "COMMITTEE" ? COMMITTEE_ROLE : upper;
};

const extractToken = (socket) => {
  const handshake = socket.handshake || {};
  const auth = handshake.auth || {};
  const header = handshake.headers?.authorization || handshake.headers?.Authorization || "";
  return (
    auth.token ||
    auth.Authorization ||
    handshake.query?.token ||
    (header.startsWith("Bearer ") ? header.slice(7).trim() : "") ||
    ""
  ).trim();
};

/**
 * Resolves every society the user belongs to, with the role grants that apply
 * inside each of them.
 *
 * @returns {Array<{ societyId: number, roles: string[], status: string }>}
 */
const resolveMemberships = async (user) => {
  const rows = await UserSociety.findAll({
    where: { user_id: user.id },
    attributes: ["id", "society_id", "membership_status"],
  });
  if (!rows || rows.length === 0) return [];

  const roleRows = await UserSocietyRole.findAll({
    where: { user_society_id: rows.map((r) => r.id) },
    attributes: ["user_society_id", "role"],
  });

  const rolesByMembership = new Map();
  for (const row of roleRows || []) {
    const list = rolesByMembership.get(row.user_society_id) || [];
    list.push(row.role);
    rolesByMembership.set(row.user_society_id, list);
  }

  return rows.map((row) => ({
    societyId: row.society_id,
    roles: rolesByMembership.get(row.id) || [],
    status: row.membership_status,
  }));
};

/**
 * Socket.IO handshake middleware. Verifies the JWT and populates
 * `socket.data.user` with the caller's identity and grants.
 */
async function authenticate(socket, next) {
  try {
    const token = extractToken(socket);
    if (!token) {
      return next(new Error("UNAUTHORIZED: no token provided"));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const reason =
        err && err.name === "TokenExpiredError" ? "token expired" : "token invalid";
      return next(new Error(`UNAUTHORIZED: ${reason}`));
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return next(new Error("UNAUTHORIZED: user not found"));
    }

    const globalRoles =
      Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role];
    const isSuperAdmin =
      user.role === "SUPER_ADMIN" || globalRoles.includes("SUPER_ADMIN");

    const memberships = await resolveMemberships(user);

    socket.data.user = {
      id: user.id,
      name: user.name || null,
      // Roles that hold everywhere the user is a member.
      roles: globalRoles,
      // Per-society role grants, used to validate role/society room joins.
      memberships,
      isSuperAdmin,
      isCommittee: Boolean(user.is_committee_member) || Boolean(user.is_committee),
      // Society + role the token was issued for — the default scope.
      defaultSocietyId:
        decoded.society_id != null ? parseInt(decoded.society_id, 10) : user.society_id || null,
      defaultRole: normaliseRole(decoded.activeRole) || null,
    };

    return next();
  } catch (err) {
    console.error("[socketAuth] Unexpected error:", err.message);
    return next(new Error("UNAUTHORIZED: internal error"));
  }
}

/**
 * Resolves the role a socket may use inside `societyId`.
 *
 * @returns {string|null} the role, or null when the user has no valid role there.
 */
function resolveRoleFor(identity, societyId, requestedRole) {
  if (!identity) return null;

  const membership = identity.memberships?.find(
    (m) => Number(m.societyId) === Number(societyId)
  );
  const societyRoles = membership?.roles || [];
  const allowed = societyRoles.length > 0 ? societyRoles : identity.roles || [];

  const wanted = normaliseRole(requestedRole);
  const isCommittee =
    wanted === COMMITTEE_ROLE && (identity.isCommittee || allowed.includes(COMMITTEE_ROLE));

  if (wanted && (allowed.includes(wanted) || isCommittee)) return wanted;

  const fallback = identity.defaultRole;
  if (fallback && allowed.includes(fallback)) return fallback;

  return allowed[0] || identity.roles?.[0] || null;
}

/**
 * Resolves whether a socket may join a society room.
 *
 * @returns {{ allowed: boolean, societyId: number|null }}
 */
function resolveSocietyFor(identity, requestedSocietyId) {
  if (!identity) return { allowed: false, societyId: null };

  const requested =
    requestedSocietyId === undefined || requestedSocietyId === null || requestedSocietyId === ""
      ? null
      : parseInt(requestedSocietyId, 10);

  if (requested === null || Number.isNaN(requested)) {
    return { allowed: true, societyId: identity.defaultSocietyId ?? null };
  }

  if (identity.isSuperAdmin) {
    return { allowed: true, societyId: requested };
  }

  const membership = identity.memberships?.find(
    (m) => Number(m.societyId) === requested
  );
  if (!membership) {
    if (identity.defaultSocietyId != null && Number(identity.defaultSocietyId) === requested) {
      return { allowed: true, societyId: requested };
    }
    return { allowed: false, societyId: null };
  }
  if (membership.status && membership.status !== "ACTIVE") {
    return { allowed: false, societyId: null };
  }

  return { allowed: true, societyId: requested };
}

module.exports = { authenticate, resolveRoleFor, resolveSocietyFor, normaliseRole };
