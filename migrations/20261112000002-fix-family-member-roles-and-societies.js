"use strict";

/**
 * Migration: 20261112000002-fix-family-member-roles-and-societies
 *
 * Restores FAMILY_MEMBER role for users linked to household_members who were
 * incorrectly changed to RESIDENT by toggleAdminAccess.
 * Backfills missing user_societies and user_society_roles records for family members.
 * Strictly preserves genuine Owners, Tenants, and Multi-Society accounts.
 */

module.exports = {
  up: async (conn) => {
    // 1. Fetch all household members linked to a user account
    const [householdMembers] = await conn.query(`
      SELECT hm.id AS hm_id, hm.name, hm.email, hm.relation, hm.work, hm.isAdmin,
             hm.flat_id, hm.user_id,
             u.role AS user_role, u.roles AS user_roles, u.society_id AS user_soc_id,
             f.resident_id AS flat_resident_id,
             b.society_id AS flat_soc_id
      FROM household_members hm
      INNER JOIN users u ON hm.user_id = u.id
      LEFT JOIN flats f ON hm.flat_id = f.id
      LEFT JOIN floors fl ON f.floor_id = fl.id
      LEFT JOIN blocks b ON (fl.block_id = b.id OR f.block_id = b.id)
      WHERE hm.user_id IS NOT NULL AND hm.work IS NULL
    `);

    for (const hm of householdMembers) {
      const userId = hm.user_id;
      const targetSocietyId = hm.flat_soc_id || hm.user_soc_id;

      // 2. Check if user is a genuine Owner or Tenant
      const [memberships] = await conn.query(`
        SELECT id FROM FlatMemberships 
        WHERE user_id = ? AND is_current = 1 AND role IN ('OWNER', 'TENANT')
        LIMIT 1
      `, [userId]);

      const isDirectOwner = (hm.flat_resident_id === userId);
      const isGenuineResident = memberships.length > 0 || isDirectOwner;

      // If NOT a genuine resident, ensure their role is FAMILY_MEMBER
      if (!isGenuineResident) {
        let currentRoles = [];
        try {
          currentRoles = typeof hm.user_roles === "string" ? JSON.parse(hm.user_roles) : (hm.user_roles || []);
        } catch {
          currentRoles = [];
        }

        // Remove accidental RESIDENT from roles and ensure FAMILY_MEMBER
        const cleanRoles = Array.from(new Set(
          currentRoles.filter((r) => r !== "RESIDENT").concat(["FAMILY_MEMBER"])
        ));

        await conn.query(`
          UPDATE users 
          SET role = 'FAMILY_MEMBER', roles = ?
          WHERE id = ?
        `, [JSON.stringify(cleanRoles), userId]);

        // Also clean up any accidental RESIDENT role from user_society_roles
        await conn.query(`
          DELETE usr FROM user_society_roles usr
          INNER JOIN user_societies us ON usr.user_society_id = us.id
          WHERE us.user_id = ? AND usr.role = 'RESIDENT'
        `, [userId]);
      }

      // 3. Ensure user_societies row exists
      if (targetSocietyId) {
        const [existingUserSoc] = await conn.query(`
          SELECT id FROM user_societies 
          WHERE user_id = ? AND society_id = ?
          LIMIT 1
        `, [userId, targetSocietyId]);

        let userSocietyId;
        if (existingUserSoc.length === 0) {
          const [insertRes] = await conn.query(`
            INSERT INTO user_societies (user_id, society_id, membership_status, is_default, source, created_at, updated_at)
            VALUES (?, ?, 'ACTIVE', 1, 'HOUSEHOLD', NOW(), NOW())
          `, [userId, targetSocietyId]);
          userSocietyId = insertRes.insertId;
        } else {
          userSocietyId = existingUserSoc[0].id;
        }

        // 4. Ensure user_society_roles row exists
        const [existingRoles] = await conn.query(`
          SELECT id FROM user_society_roles 
          WHERE user_society_id = ? AND role = 'FAMILY_MEMBER'
          LIMIT 1
        `, [userSocietyId]);

        if (existingRoles.length === 0) {
          await conn.query(`
            INSERT INTO user_society_roles (user_society_id, role, created_at)
            VALUES (?, 'FAMILY_MEMBER', NOW())
          `, [userSocietyId]);
        }
      }
    }
  },

  down: async () => {
    // Migration is safe and corrective; no destructive rollback needed
  },
};
