const { Flat, Block, FlatMembership, HouseHoldMember, User, UserSociety } = require("../models");
const { Op } = require("sequelize");

/**
 * Resolves every ACTIVE user id that belongs to a society.
 *
 * `users.society_id` only stores the user's PRIMARY society. Multi-society
 * residents (a resident who owns a flat in this society but whose primary
 * society is another one) are therefore invisible to any query that filters on
 * that column — even though they hold an ACTIVE membership in the society and
 * are a valid audience for society-scoped content.
 *
 * This helper unions both sources:
 *   - `user_societies` rows with `membership_status = 'ACTIVE'`
 *   - users whose primary society is this one, unless they have a membership
 *     row for this society that is not ACTIVE (rejected / suspended / left)
 *
 * @param {number} societyId
 * @returns {Promise<number[]>} Array of unique user IDs
 */
const getSocietyMemberUserIds = async (societyId) => {
  if (!societyId) return [];

  const societyIdNum = Number(societyId);
  if (Number.isNaN(societyIdNum)) return [];

  const userIds = new Set();

  // Users with an explicit ACTIVE membership in this society.
  let activeMemberIds = new Set();
  let inactiveMemberIds = new Set();
  try {
    const memberships = await UserSociety.findAll({
      where: { society_id: societyIdNum },
      attributes: ["user_id", "membership_status"],
    });
    memberships.forEach((m) => {
      if (!m.user_id) return;
      if (m.membership_status === "ACTIVE") activeMemberIds.add(Number(m.user_id));
      else inactiveMemberIds.add(Number(m.user_id));
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching UserSociety memberships:", err.message);
  }

  activeMemberIds.forEach((id) => userIds.add(id));

  // Users whose primary society is this one (legacy members that predate the
  // user_societies table, or members whose primary was never moved).
  try {
    const primaryUsers = await User.findAll({
      where: { society_id: societyIdNum },
      attributes: ["id"],
    });
    primaryUsers.forEach((u) => {
      if (!u.id) return;
      const id = Number(u.id);
      // An explicit non-ACTIVE membership wins over the primary-society flag.
      if (inactiveMemberIds.has(id) && !activeMemberIds.has(id)) return;
      userIds.add(id);
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching primary society users:", err.message);
  }

  return Array.from(userIds);
};

/**
 * Resolves all flat IDs that a given user is legitimately authorized to access
 * (as Owner, Tenant, or Household Member with current/active status) within a society.
 * 
 * @param {number} userId 
 * @param {number|null} societyId 
 * @returns {Promise<number[]>} Array of unique flat IDs
 */
const getUserAuthorizedFlatIds = async (userId, societyId = null) => {
  if (!userId) return [];

  const rawFlatIds = new Set();
  const today = new Date().toISOString().split("T")[0];

  // 1. Check FlatMembership (Owner or Tenant where is_current = true and not moved out)
  try {
    const memberships = await FlatMembership.findAll({
      where: {
        user_id: userId,
        is_current: true,
        [Op.or]: [
          { move_out_date: null },
          { move_out_date: { [Op.gte]: today } }
        ]
      },
      attributes: ["flat_id"]
    });
    memberships.forEach((m) => {
      if (m.flat_id) rawFlatIds.add(Number(m.flat_id));
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching FlatMemberships:", err.message);
  }

  // 2. Check direct Flat ownership / primary resident link
  try {
    const directFlats = await Flat.findAll({
      where: { resident_id: userId },
      attributes: ["id"]
    });
    directFlats.forEach((f) => {
      if (f.id) rawFlatIds.add(Number(f.id));
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching direct Flats:", err.message);
  }

  // 3. Check Household Members
  try {
    const household = await HouseHoldMember.findAll({
      where: { user_id: userId },
      attributes: ["flat_id"]
    });
    household.forEach((h) => {
      if (h.flat_id) rawFlatIds.add(Number(h.flat_id));
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching HouseHoldMembers:", err.message);
  }

  if (rawFlatIds.size === 0) return [];

  const candidateIds = Array.from(rawFlatIds);

  // 4. Verify flats belong to the requested society_id if provided
  if (societyId) {
    try {
      const verifiedFlats = await Flat.findAll({
        where: { id: { [Op.in]: candidateIds } },
        attributes: ["id"],
        include: [
          {
            model: Block,
            where: { society_id: Number(societyId) },
            attributes: ["id", "society_id"],
            required: true
          }
        ]
      });
      return verifiedFlats.map((f) => Number(f.id));
    } catch (err) {
      console.error("[accessHelpers] Error verifying flats with Block/Society:", err.message);
      return candidateIds;
    }
  }

  return candidateIds;
};

/** Resolve only active flats where the user is the owner (not tenant/family). */
const getUserOwnedFlatIds = async (userId, societyId = null) => {
  if (!userId) return [];
  const ownedIds = new Set();
  const today = new Date().toISOString().split("T")[0];

  const memberships = await FlatMembership.findAll({
    where: {
      user_id: userId,
      role: "OWNER",
      is_current: true,
      [Op.or]: [{ move_out_date: null }, { move_out_date: { [Op.gte]: today } }],
    },
    attributes: ["flat_id"],
  });
  memberships.forEach((m) => m.flat_id && ownedIds.add(Number(m.flat_id)));

  const directFlats = await Flat.findAll({ where: { resident_id: userId }, attributes: ["id"] });
  directFlats.forEach((f) => f.id && ownedIds.add(Number(f.id)));

  if (!societyId || ownedIds.size === 0) return Array.from(ownedIds);
  const verified = await Flat.findAll({
    where: { id: { [Op.in]: Array.from(ownedIds) } },
    attributes: ["id"],
    include: [{ model: Block, where: { society_id: Number(societyId) }, attributes: [], required: true }],
  });
  return verified.map((f) => Number(f.id));
};

/**
 * Resolves all active User IDs associated with a specific Flat (Owner, Current Tenant, Household Members).
 * 
 * @param {number} flatId 
 * @param {number|null} societyId 
 * @returns {Promise<number[]>} Deduplicated array of user IDs
 */
const getFlatAuthorizedUserIds = async (flatId, societyId = null) => {
  if (!flatId) return [];

  const userIds = new Set();
  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Direct Flat owner / primary resident
    const flat = await Flat.findByPk(flatId, {
      attributes: ["id", "resident_id"],
      include: societyId
        ? [
            {
              model: Block,
              where: { society_id: Number(societyId) },
              attributes: ["id", "society_id"],
              required: true
            }
          ]
        : []
    });

    if (!flat) return [];
    if (flat.resident_id) userIds.add(Number(flat.resident_id));

    // 2. Active FlatMemberships (Owners & Tenants)
    const memberships = await FlatMembership.findAll({
      where: {
        flat_id: flatId,
        is_current: true,
        [Op.or]: [
          { move_out_date: null },
          { move_out_date: { [Op.gte]: today } }
        ]
      },
      attributes: ["user_id"]
    });
    memberships.forEach((m) => {
      if (m.user_id) userIds.add(Number(m.user_id));
    });

    // 3. Active Household Members
    const household = await HouseHoldMember.findAll({
      where: {
        flat_id: flatId,
        user_id: { [Op.ne]: null }
      },
      attributes: ["user_id"]
    });
    household.forEach((h) => {
      if (h.user_id) userIds.add(Number(h.user_id));
    });
  } catch (err) {
    console.error("[accessHelpers] Error fetching flat authorized users:", err.message);
  }

  return Array.from(userIds);
};

/**
 * Check if a user has authorized access to a specific flat
 */
const isUserAuthorizedForFlat = async (userId, flatId, societyId = null) => {
  if (!userId || !flatId) return false;
  const userFlatIds = await getUserAuthorizedFlatIds(userId, societyId);
  return userFlatIds.includes(Number(flatId));
};

/* =====
   LEGACY HELPERS (PRESERVED)
===== */
const findAuthorizedFlat = async (userId) => {
  const ownerFlat = await Flat.findOne({ where: { resident_id: userId } });
  if (ownerFlat) return ownerFlat;
  const member = await HouseHoldMember.findOne({
    where: { 
      user_id: userId, 
      isAdmin: true 
    }
  });

  if (member) {
    return await Flat.findByPk(member.flat_id);
  }

  return null;
};

const getFlatForUser = async (userId) => {
  let flat = await Flat.findOne({ 
    where: { resident_id: userId },
    include: [{ model: Block, attributes: ["id", "name", "society_id"] }]
  });
  
  if (flat) return flat;

  const member = await HouseHoldMember.findOne({
    where: { user_id: userId }
  });

  if (member) {
    return await Flat.findByPk(member.flat_id, {
      include: [{ model: Block, attributes: ["id", "name", "society_id"] }]
    });
  }

  return null;
};

module.exports = {
  getUserAuthorizedFlatIds,
  getUserOwnedFlatIds,
  getFlatAuthorizedUserIds,
  isUserAuthorizedForFlat,
  getSocietyMemberUserIds,
  findAuthorizedFlat,
  getFlatForUser
};
