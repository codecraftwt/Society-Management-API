const { HouseHoldMember, User, Flat, FlatMembership, UserSociety, UserSocietyRole } = require("../models");
const sequelize = require("../config/db");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { sendEmail } = require("../services/emailService");
const { isDailyHelpMember } = require("../utils/dailyHelpUtils");

// ✅ Helper: safely parse roles — always returns a plain array
const parseRoles = (roles) => {
  if (!roles) return [];
  if (Array.isArray(roles)) return [...roles];
  try {
    const parsed = JSON.parse(roles);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/* =
   GET MY HOUSEHOLD
= */
exports.getMyHousehold = async (req, res) => {
  try {
    const flatId = req.flatId;

    // 1. Fetch Flat details and direct owner (Flat.resident_id)
    const flat = await Flat.findByPk(flatId, {
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "status", "approval_status", "role"],
          required: false,
        },
      ],
    });

    // 2. Fetch primary memberships (Owner / Tenant) from FlatMembership
    const flatMemberships = await FlatMembership.findAll({
      where: { flat_id: flatId, is_current: true },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "status", "approval_status", "role"],
          required: false,
        },
      ],
    });

    // 3. Fetch household members (Family Members & Daily Help)
    const householdMembers = await HouseHoldMember.findAll({
      where: { flat_id: flatId },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "status", "approval_status", "role"],
          required: false,
        },
      ],
      order: [["created_at", "ASC"]],
    });

    const resultList = [];
    // IDs can arrive as strings or numbers depending on the Sequelize column
    // and legacy records. Normalize them so the same resident is never shown
    // twice and the logged-in resident is not accidentally omitted.
    const includedUserIds = new Set();
    const addIncludedUserId = (id) => {
      if (id != null) includedUserIds.add(String(id));
    };

    // 1. Add direct owner via Flat.resident_id
    if (flat && flat.resident_id && flat.User) {
      const ownerUser = flat.User;
      addIncludedUserId(ownerUser.id);
      resultList.push({
        id: `primary_${ownerUser.id}`,
        user_id: ownerUser.id,
        flat_id: flatId,
        name: ownerUser.name,
        email: ownerUser.email,
        phone: ownerUser.phone,
        relation: "Owner",
        work: null,
        isAdmin: true,
        is_primary: true,
        is_owner: true,
        is_tenant: false,
        resident_type: "OWNER",
        has_login: true,
        isDailyHelp: false,
        is_self: Boolean(req.user && req.user.id === ownerUser.id),
        User: ownerUser.toJSON ? ownerUser.toJSON() : ownerUser,
      });
    }

    // 2. Add FlatMembership occupants (Owner / Tenant)
    for (const fm of flatMemberships) {
      if (!fm.User || includedUserIds.has(String(fm.User.id))) continue;
      const u = fm.User;
      addIncludedUserId(u.id);
      const isOwner = fm.role === "OWNER";
      const isTenant = fm.role === "TENANT";
      resultList.push({
        id: `membership_${fm.id}`,
        user_id: u.id,
        flat_id: flatId,
        name: u.name,
        email: u.email,
        phone: u.phone,
        relation: isTenant ? "Tenant" : "Owner",
        work: null,
        isAdmin: true,
        is_primary: true,
        is_owner: isOwner,
        is_tenant: isTenant,
        resident_type: isTenant ? "TENANT" : "OWNER",
        has_login: true,
        isDailyHelp: false,
        is_self: Boolean(req.user && req.user.id === u.id),
        User: u.toJSON ? u.toJSON() : u,
      });
    }

    // 3. Add household members (Family Members & Daily Help)
    for (const member of householdMembers) {
      const plain = member.toJSON ? member.toJSON() : member;
      if (plain.user_id && includedUserIds.has(String(plain.user_id))) {
        continue;
      }
      if (plain.user_id) addIncludedUserId(plain.user_id);

      const hasUserAccount = Boolean(plain.user_id && plain.User);
      const isAccountActive = plain.User ? plain.User.status === "ACTIVE" : true;
      const isAccessActive = Boolean(plain.isAdmin && isAccountActive);
      const isHelp = isDailyHelpMember(plain);
      resultList.push({
        ...plain,
        has_login: hasUserAccount,
        has_access: isAccessActive,
        is_active: isAccessActive,
        isDailyHelp: isHelp,
        is_primary: false,
        is_owner: false,
        is_tenant: false,
        resident_type: isHelp ? "DAILY_HELP" : "FAMILY_MEMBER",
        is_self: Boolean(req.user && plain.user_id && req.user.id === plain.user_id),
      });
    }

    // Some older family-member rows were created without user_id. The
    // authenticated resident still belongs to this flat and must be visible
    // in the household list.
    if (req.user && !includedUserIds.has(String(req.user.id))) {
      const currentUser = await User.findByPk(req.user.id, {
        attributes: ["id", "name", "email", "phone", "status", "approval_status", "role", "resident_type"],
      });

      if (currentUser) {
        const u = currentUser.toJSON ? currentUser.toJSON() : currentUser;
        resultList.push({
          id: `self_${u.id}`,
          user_id: u.id,
          flat_id: flatId,
          name: u.name,
          email: u.email,
          phone: u.phone,
          relation: u.resident_type === "TENANT" ? "Tenant" : "Family Member",
          work: null,
          isAdmin: false,
          is_primary: false,
          is_owner: false,
          is_tenant: u.resident_type === "TENANT",
          resident_type: "FAMILY_MEMBER",
          has_login: true,
          isDailyHelp: false,
          is_self: true,
          User: u,
        });
        addIncludedUserId(u.id);
      }
    }

    res.json(resultList);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   ADD HOUSEHOLD MEMBER
= */
exports.addHouseholdMember = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const isAuthorized = req.isPrimaryResident || req.user?.role === "FAMILY_MEMBER" || req.user?.role === "RESIDENT";
    if (!isAuthorized) {
      await transaction.rollback();
      return res.status(403).json({
        message: "Only the primary resident can add members",
      });
    }

    const {
      name,
      phone,
      email,
      relation,
      work,
      flat_id,
      enable_login,
      password,
      confirm_password,
    } = req.body;

    if (!name || !name.trim()) {
      await transaction.rollback();
      return res.status(400).json({ message: "Name is required" });
    }

    // Multi-flat support: the client may specify which flat the member belongs to.
    let targetFlatId = req.flatId;
    if (flat_id !== undefined && flat_id !== null && flat_id !== "") {
      const { getUserAuthorizedFlatIds } = require("../utils/accessHelpers");
      const ownedFlatIds = await getUserAuthorizedFlatIds(req.user.id, req.user.society_id);

      if (!ownedFlatIds.map(String).includes(String(flat_id))) {
        await transaction.rollback();
        return res.status(403).json({
          message: "You can only add members to your own flats in this society",
        });
      }

      targetFlatId = Number(flat_id);
    }

    let createdUser = null;
    // Family members are collected with a required email and password in the
    // resident form. Always provision their account so granting household
    // access can actually be used for login and the admin resident directory.
    // Daily help remains a non-login household record.
    const isLoginRequested = !work;

    if (isLoginRequested) {
      if (!email || !email.trim()) {
        await transaction.rollback();
        return res.status(400).json({ message: "Email is required when login access is enabled" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        await transaction.rollback();
        return res.status(400).json({ message: "Please provide a valid email address" });
      }

      if (!password || typeof password !== "string" || password.length < 6) {
        await transaction.rollback();
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }

      if (confirm_password !== undefined && password !== confirm_password) {
        await transaction.rollback();
        return res.status(400).json({ message: "Passwords do not match" });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existingUser = await User.findOne({
        where: { email: normalizedEmail },
        transaction,
      });

      if (existingUser) {
        // Disallow taking over management or outside accounts
        const existingRoles = parseRoles(existingUser.roles);
        const forbiddenRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT", "GUARD"];
        if (forbiddenRoles.includes(existingUser.role) || existingRoles.some((r) => forbiddenRoles.includes(r))) {
          await transaction.rollback();
          return res.status(400).json({
            message: "This email is already associated with an administrative account and cannot be added as a family member",
          });
        }

        // Check if user is already linked to another household member
        const existingHh = await HouseHoldMember.findOne({
          where: { user_id: existingUser.id },
          transaction,
        });

        if (existingHh) {
          await transaction.rollback();
          return res.status(400).json({
            message: "This email is already registered to a household member in a flat",
          });
        }

        // Safely link the existing account, ensuring role is FAMILY_MEMBER
        const hashedPassword = await bcrypt.hash(password, 10);
        await existingUser.update(
          {
            password: hashedPassword,
            role: "FAMILY_MEMBER",
            roles: ["FAMILY_MEMBER"],
            status: "ACTIVE",
            approval_status: "APPROVED",
          },
          { transaction }
        );

        createdUser = existingUser;
      } else {
        const hashedPassword = await bcrypt.hash(password, 10);
        createdUser = await User.create(
          {
            name: name.trim(),
            email: normalizedEmail,
            phone: phone ? phone.trim() : null,
            password: hashedPassword,
            role: "FAMILY_MEMBER",
            roles: ["FAMILY_MEMBER"],
            society_id: req.user.society_id,
            status: "ACTIVE",
            approval_status: "APPROVED",
          },
          { transaction }
        );
      }

      // Ensure UserSociety membership exists
      const [userSociety] = await UserSociety.findOrCreate({
        where: {
          user_id: createdUser.id,
          society_id: req.user.society_id,
        },
        defaults: {
          membership_status: "ACTIVE",
          is_default: true,
          resident_type: null,
          source: "HOUSEHOLD",
          joined_at: new Date(),
        },
        transaction,
      });

      // Ensure UserSocietyRole exists with FAMILY_MEMBER
      await UserSocietyRole.findOrCreate({
        where: {
          user_society_id: userSociety.id,
          role: "FAMILY_MEMBER",
        },
        transaction,
      });
    }

    const member = await HouseHoldMember.create(
      {
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        relation: work ? "Daily Help" : (relation || "Family"),
        work: work ? work.trim() : null,
        email: email ? email.trim().toLowerCase() : null,
        flat_id: targetFlatId,
        user_id: createdUser ? createdUser.id : null,
        isAdmin: false,
      },
      { transaction }
    );

    await transaction.commit();

    const plainMember = member.toJSON();
    delete plainMember.password;

    res.status(201).json({
      message: "Household member added successfully",
      member: {
        ...plainMember,
        has_login: Boolean(createdUser),
      },
    });

  } catch (err) {
    if (transaction) await transaction.rollback();
    res.status(500).json({ message: err.message });
  }
};

/* =
   TOGGLE ADMIN ACCESS / APP ACCESS
   Note: Primary owner toggles access for household members.
   When access is revoked (isAdmin = false), the linked user is marked INACTIVE,
   FCM token is cleared, and UserSociety status is set to SUSPENDED.
   When access is granted (isAdmin = true), the linked user is marked ACTIVE,
   and UserSociety status is restored to ACTIVE.
= */
exports.toggleAdminAccess = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const isAuthorized = Boolean(req.isPrimaryResident);
    if (!isAuthorized) {
      await transaction.rollback();
      return res.status(403).json({
        message: "Only the primary flat owner can change member access",
      });
    }

    const { id } = req.params;
    if (String(id).startsWith("primary_") || String(id).startsWith("membership_")) {
      await transaction.rollback();
      return res.status(400).json({ message: "Flat owner always has full admin access" });
    }

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
      transaction,
    });

    if (!member) {
      await transaction.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    if (member.work) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Daily helpers cannot be granted admin access",
      });
    }

    const newAccessState = !member.isAdmin;
    member.isAdmin = newAccessState;
    await member.save({ transaction });

    // Synchronize linked User account and UserSociety membership
    if (member.user_id) {
      const linkedUser = await User.findByPk(member.user_id, { transaction });
      if (linkedUser) {
        if (!newAccessState) {
          // Revoke access: mark INACTIVE, clear push token, suspend society membership
          await linkedUser.update(
            {
              status: "INACTIVE",
              fcm_token: null,
            },
            { transaction }
          );

          await UserSociety.update(
            { membership_status: "SUSPENDED" },
            {
              where: {
                user_id: linkedUser.id,
                society_id: req.user.society_id,
              },
              transaction,
            }
          );
        } else {
          // Grant access: mark ACTIVE, restore society membership
          await linkedUser.update(
            {
              status: "ACTIVE",
            },
            { transaction }
          );

          await UserSociety.update(
            { membership_status: "ACTIVE" },
            {
              where: {
                user_id: linkedUser.id,
                society_id: req.user.society_id,
              },
              transaction,
            }
          );
        }
      }
    }

    await transaction.commit();

    // Real-time notification if access is revoked
    if (!newAccessState && member.user_id && global.io) {
      global.io.to(`user_${member.user_id}`).emit("access_revoked", {
        userId: member.user_id,
        title: "Access Revoked",
        reason: "Your access has been removed by the primary resident.",
        message: "Your access to the resident panel has been removed by the household admin. You will be logged out.",
      });
    }

    res.json({
      message: newAccessState ? "Access granted successfully" : "Access revoked successfully",
      isAdmin: newAccessState,
      has_access: newAccessState,
    });

  } catch (err) {
    if (transaction) await transaction.rollback();
    res.status(500).json({ message: err.message });
  }
};

/* =
   RESET / SET HOUSEHOLD MEMBER PASSWORD
= */
exports.resetMemberPassword = async (req, res) => {
  try {
    const isAuthorized = Boolean(req.isPrimaryResident);
    if (!isAuthorized) {
      return res.status(403).json({
        message: "Only the primary flat owner can reset household member passwords",
      });
    }

    const { id } = req.params;
    if (String(id).startsWith("primary_") || String(id).startsWith("membership_")) {
      return res.status(400).json({ message: "Owner password must be updated through account settings" });
    }
    const { password, confirm_password } = req.body;

    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long",
      });
    }

    if (confirm_password !== undefined && password !== confirm_password) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Household member not found" });
    }

    if (!member.user_id) {
      // If member has email but no account yet, create one
      if (!member.email) {
        return res.status(400).json({
          message: "This member does not have an email address. Please update their email first.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await User.create({
        name: member.name,
        email: member.email,
        phone: member.phone || null,
        password: hashedPassword,
        role: "FAMILY_MEMBER",
        roles: ["FAMILY_MEMBER"],
        society_id: req.user.society_id,
        status: "ACTIVE",
        approval_status: "APPROVED",
      });

      const [userSociety] = await UserSociety.findOrCreate({
        where: { user_id: newUser.id, society_id: req.user.society_id },
        defaults: { membership_status: "ACTIVE", is_default: true, source: "HOUSEHOLD" },
      });

      await UserSocietyRole.findOrCreate({
        where: { user_society_id: userSociety.id, role: "FAMILY_MEMBER" },
      });

      member.user_id = newUser.id;
      await member.save();

      return res.json({ message: "Login account created and password set successfully" });
    }

    const linkedUser = await User.findByPk(member.user_id);
    if (!linkedUser) {
      return res.status(404).json({ message: "Linked user account not found" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await linkedUser.update({ password: hashedPassword });

    res.json({ message: "Password updated successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   REMOVE HOUSEHOLD MEMBER
= */
exports.removeHouseholdMember = async (req, res) => {
  try {
    const isAuthorized = Boolean(req.isPrimaryResident);
    if (!isAuthorized) {
      return res.status(403).json({
        message: "Only the primary flat owner can remove members",
      });
    }

    const { id } = req.params;
    if (String(id).startsWith("primary_") || String(id).startsWith("membership_")) {
      return res.status(400).json({ message: "Cannot remove flat owner or primary resident from household" });
    }

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    if (member.user_id) {
      const linkedUser = await User.findByPk(member.user_id);

      if (linkedUser) {
        const isPrimaryElsewhere = await Flat.count({
          where: { resident_id: member.user_id },
        });

        const otherMemberships = await HouseHoldMember.count({
          where: {
            user_id: member.user_id,
            id: { [Op.ne]: member.id },
          },
        });

        if (isPrimaryElsewhere === 0 && otherMemberships === 0) {
          // Clean up user societies and roles
          const userSocieties = await UserSociety.findAll({ where: { user_id: member.user_id } });
          for (const us of userSocieties) {
            await UserSocietyRole.destroy({ where: { user_society_id: us.id } });
            await us.destroy();
          }
          await linkedUser.destroy();
        } else {
          // User exists elsewhere; suspend their access for this society
          await UserSociety.update(
            { membership_status: "SUSPENDED" },
            { where: { user_id: member.user_id, society_id: req.user.society_id } }
          );
        }
      }
    }

    const linkedUserId = member.user_id;
    await member.destroy();

    if (linkedUserId && global.io) {
      global.io.to(`user_${linkedUserId}`).emit("access_revoked", {
        userId: linkedUserId,
        title: "Access Removed",
        reason: "You have been removed from the household.",
        message: "Your household membership has been removed by the primary resident. You will be logged out.",
      });
    }

    res.json({ message: "Member removed successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   UPDATE HOUSEHOLD MEMBER
= */
exports.updateHouseholdMember = async (req, res) => {
  try {
    const isAuthorized = req.isPrimaryResident || req.user?.role === "FAMILY_MEMBER" || req.user?.role === "RESIDENT";
    if (!isAuthorized) {
      return res.status(403).json({
        message: "Only the primary resident can update members",
      });
    }

    const { id } = req.params;
    const { name, email, phone } = req.body;

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    const updateFields = {};
    if (name !== undefined) updateFields.name = name.trim();
    if (email !== undefined) updateFields.email = email ? email.trim().toLowerCase() : null;
    if (phone !== undefined) updateFields.phone = phone ? phone.trim() : null;

    await member.update(updateFields);

    if (member.user_id) {
      const linkedUser = await User.findByPk(member.user_id);
      if (linkedUser) {
        await linkedUser.update(updateFields);
      }
    }

    res.json({
      message: "Member updated successfully",
      data: member,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
