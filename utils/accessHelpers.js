const { Flat, Block, FlatMembership, HouseHoldMember, User } = require("../models");
const { Op } = require("sequelize");

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
  getFlatAuthorizedUserIds,
  isUserAuthorizedForFlat,
  findAuthorizedFlat,
  getFlatForUser
};