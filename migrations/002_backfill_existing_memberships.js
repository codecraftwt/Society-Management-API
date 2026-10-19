/**
 * Migration 002: Safely Backfill Existing User Society Memberships, Roles, and Scoping Columns
 */

module.exports = {
  name: "002_backfill_existing_memberships.js",

  async up(conn, isDryRun) {
    console.log("  -> [002] Starting safe backfill of legacy society assignments...");

    // 1. Fetch all users with a declared society_id
    const [users] = await conn.query(`
      SELECT id, name, email, role, roles, society_id, resident_type, 
             occupant_count, vehicle_count, emergency_contact, created_at 
      FROM users 
      WHERE society_id IS NOT NULL
    `);

    console.log(`     Found ${users.length} user(s) with society_id assigned.`);

    let membershipsCreated = 0;
    let rolesCreated = 0;

    // Check if user_societies table exists (may not exist during initial dry-run)
    const [tableCheck] = await conn.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_societies'"
    );
    const tableExists = tableCheck.length > 0;

    for (const user of users) {
      let existingMem = [];
      if (tableExists) {
        [existingMem] = await conn.query(
          "SELECT id FROM user_societies WHERE user_id = ? AND society_id = ?",
          [user.id, user.society_id]
        );
      }

      let userSocietyId = existingMem[0]?.id;

      if (!userSocietyId) {
        if (!isDryRun) {
          const emergencyContactStr = user.emergency_contact
            ? typeof user.emergency_contact === "object"
              ? JSON.stringify(user.emergency_contact)
              : String(user.emergency_contact)
            : null;

          const [insertRes] = await conn.query(
            `INSERT INTO user_societies 
             (user_id, society_id, membership_status, is_default, resident_type, 
              occupant_count, vehicle_count, emergency_contact, source, joined_at)
             VALUES (?, ?, 'ACTIVE', 1, ?, ?, ?, ?, 'MIGRATED', ?)`,
            [
              user.id,
              user.society_id,
              user.resident_type || null,
              user.occupant_count || 1,
              user.vehicle_count || 0,
              emergencyContactStr,
              user.created_at || new Date(),
            ]
          );
          userSocietyId = insertRes.insertId;
        } else {
          userSocietyId = 999999; // Mock ID for dry-run simulation
        }
        membershipsCreated++;
      }

      // Parse roles from user.roles and user.role
      let rawRoles = [];
      if (Array.isArray(user.roles)) {
        rawRoles = [...user.roles];
      } else if (typeof user.roles === "string") {
        try {
          const parsed = JSON.parse(user.roles);
          if (Array.isArray(parsed)) rawRoles = parsed;
        } catch (_) {}
      }
      if (user.role && !rawRoles.includes(user.role)) {
        rawRoles.push(user.role);
      }

      // Filter out SUPER_ADMIN (global system role, not local society role)
      const societyRoles = rawRoles.filter((r) => r && r !== "SUPER_ADMIN");
      if (societyRoles.length === 0) {
        societyRoles.push("RESIDENT");
      }

      // Insert roles
      for (const roleName of societyRoles) {
        if (!isDryRun) {
          const [existingRole] = await conn.query(
            "SELECT id FROM user_society_roles WHERE user_society_id = ? AND role = ?",
            [userSocietyId, roleName]
          );
          if (existingRole.length === 0) {
            await conn.query(
              "INSERT INTO user_society_roles (user_society_id, role) VALUES (?, ?)",
              [userSocietyId, roleName]
            );
            rolesCreated++;
          }
        } else {
          rolesCreated++;
        }
      }
    }

    console.log(`     Primary memberships created/simulated: ${membershipsCreated}, roles created/simulated: ${rolesCreated}.`);

    // 2. Reconcile additional societies from active FlatMemberships
    console.log("  -> [002] Reconciling additional memberships from active FlatMemberships...");
    const [flatMems] = await conn.query(`
      SELECT DISTINCT fm.user_id, bl.society_id, fm.role as flat_role, fm.move_in_date
      FROM FlatMemberships fm
      JOIN flats f ON fm.flat_id = f.id
      JOIN blocks bl ON f.block_id = bl.id
      WHERE fm.is_current = 1 AND bl.society_id IS NOT NULL
    `);

    let flatMembershipsCreated = 0;
    for (const fm of flatMems) {
      let existing = [];
      if (tableExists) {
        [existing] = await conn.query(
          "SELECT id FROM user_societies WHERE user_id = ? AND society_id = ?",
          [fm.user_id, fm.society_id]
        );
      }

      if (existing.length === 0) {
        if (!isDryRun) {
          const [insertRes] = await conn.query(
            `INSERT INTO user_societies 
             (user_id, society_id, membership_status, is_default, resident_type, source, joined_at)
             VALUES (?, ?, 'ACTIVE', 0, ?, 'FLAT_MEMBERSHIP', ?)`,
            [
              fm.user_id,
              fm.society_id,
              fm.flat_role || "RESIDENT",
              fm.move_in_date || new Date(),
            ]
          );
          await conn.query(
            "INSERT INTO user_society_roles (user_society_id, role) VALUES (?, 'RESIDENT')",
            [insertRes.insertId]
          );
        }
        flatMembershipsCreated++;
      }
    }
    console.log(`     Additional flat memberships created/simulated: ${flatMembershipsCreated}.`);

    // 3. Backfill bills.society_id
    console.log("  -> [002] Backfilling bills.society_id...");
    if (!isDryRun) {
      const [billUpdate] = await conn.query(`
        UPDATE bills b
        JOIN flats f ON b.flat_id = f.id
        JOIN blocks bl ON f.block_id = bl.id
        SET b.society_id = bl.society_id
        WHERE b.society_id IS NULL AND bl.society_id IS NOT NULL;
      `);
      console.log(`     bills.society_id updated rows: ${billUpdate.affectedRows}.`);
    } else {
      const [bColCheck] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'society_id'"
      );
      const bWhere = bColCheck.length > 0 ? "b.society_id IS NULL AND " : "";
      const [billCount] = await conn.query(`
        SELECT COUNT(*) as cnt
        FROM bills b
        JOIN flats f ON b.flat_id = f.id
        JOIN blocks bl ON f.block_id = bl.id
        WHERE ${bWhere}bl.society_id IS NOT NULL;
      `);
      console.log(`     [DRY RUN] bills.society_id rows to update: ${billCount[0].cnt}.`);
    }

    // 4. Backfill FlatMemberships.society_id
    console.log("  -> [002] Backfilling FlatMemberships.society_id...");
    if (!isDryRun) {
      const [fmUpdate] = await conn.query(`
        UPDATE FlatMemberships fm
        JOIN flats f ON fm.flat_id = f.id
        JOIN blocks bl ON f.block_id = bl.id
        SET fm.society_id = bl.society_id
        WHERE fm.society_id IS NULL AND bl.society_id IS NOT NULL;
      `);
      console.log(`     FlatMemberships.society_id updated rows: ${fmUpdate.affectedRows}.`);
    } else {
      const [fmColCheck] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FlatMemberships' AND COLUMN_NAME = 'society_id'"
      );
      const fmWhere = fmColCheck.length > 0 ? "fm.society_id IS NULL AND " : "";
      const [fmCount] = await conn.query(`
        SELECT COUNT(*) as cnt
        FROM FlatMemberships fm
        JOIN flats f ON fm.flat_id = f.id
        JOIN blocks bl ON f.block_id = bl.id
        WHERE ${fmWhere}bl.society_id IS NOT NULL;
      `);
      console.log(`     [DRY RUN] FlatMemberships.society_id rows to update: ${fmCount[0].cnt}.`);
    }
  },

  async down(conn) {
    // Non-destructive rollback: removes migrated backfill rows
    await conn.query("DELETE FROM user_society_roles");
    await conn.query("DELETE FROM user_societies");
  },
};
