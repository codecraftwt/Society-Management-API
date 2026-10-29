const jwt = require("jsonwebtoken");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const { isUserResidentOfSociety } = require("../utils/accessHelpers");

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token expired. Please login again." });
      }
      return res.status(403).json({ message: "Token invalid or expired" });
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "Invalid token — user not found" });
    }

    // `user.role`/global roles describe the account, but the token's
    // activeRole describes the panel currently selected by the user. A user
    // who switched to Resident or Society Admin must not retain global event
    // visibility just because the account also has SUPER_ADMIN access.
    const globalRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role];
    const tokenActiveRole = String(decoded.activeRole || "").toUpperCase();
    const isSuperAdmin = tokenActiveRole
      ? tokenActiveRole === "SUPER_ADMIN"
      : (user.role === "SUPER_ADMIN" || globalRoles.includes("SUPER_ADMIN"));

    if (isSuperAdmin) {
      const headerSocId = req.headers["x-society-id"];
      let effectiveSocietyId = null;
      if (headerSocId && headerSocId !== "ALL") {
        effectiveSocietyId = parseInt(headerSocId, 10);
      } else if (decoded.society_id != null) {
        effectiveSocietyId = parseInt(decoded.society_id, 10);
      } else {
        effectiveSocietyId = user.society_id || null;
      }

      req.user = {
        ...user.toJSON(),
        society_id: effectiveSocietyId,
        roles: ["SUPER_ADMIN"],
        activeRole: "SUPER_ADMIN",
      };
      return next();
    }

    // Resolve target society ID from token or legacy user.society_id
    let targetSocietyId = decoded.society_id != null ? parseInt(decoded.society_id, 10) : user.society_id;

    // Resolve membership and roles for target society
    let membership = null;
    let roles = globalRoles;

    if (targetSocietyId) {
      membership = await UserSociety.findOne({
        where: { user_id: user.id, society_id: targetSocietyId },
      });

      if (membership) {
        if (membership.membership_status !== "ACTIVE") {
          return res.status(403).json({
            message: `Your membership in this society is currently ${membership.membership_status.toLowerCase()}. Access denied.`,
          });
        }

        const roleRows = await UserSocietyRole.findAll({
          where: { user_society_id: membership.id },
          attributes: ["role"],
        });

        if (roleRows && roleRows.length > 0) {
          roles = roleRows.map((r) => r.role);
        }
      }
    }

    // Check if the user is a resident of this target society
    const isResident = targetSocietyId
      ? await isUserResidentOfSociety(user, targetSocietyId)
      : false;

    if (isResident && !roles.includes("RESIDENT")) {
      roles = [...roles, "RESIDENT"];
    }

    const reqActiveRole = req.headers["x-active-role"] || req.query.role;
    let activeRole = decoded.activeRole;

    if (
      reqActiveRole &&
      (roles.includes(reqActiveRole.toUpperCase()) ||
        ((reqActiveRole.toUpperCase() === "COMMITTEE_MEMBER" || reqActiveRole.toUpperCase() === "COMMITTEE") &&
          (user.is_committee_member || user.is_committee || roles.includes("COMMITTEE_MEMBER"))) ||
        (reqActiveRole.toUpperCase() === "RESIDENT" && isResident))
    ) {
      activeRole = reqActiveRole.toUpperCase() === "COMMITTEE" ? "COMMITTEE_MEMBER" : reqActiveRole.toUpperCase();
    } else if (!activeRole || (!roles.includes(activeRole) && !(activeRole === "RESIDENT" && isResident))) {
      activeRole = roles[0];
    }

    req.user = {
      ...user.toJSON(),
      society_id: targetSocietyId,
      roles,
      activeRole,
      is_society_resident: isResident,
      can_switch_to_resident: isResident,
      ...(membership
        ? {
            resident_type: membership.resident_type ?? user.resident_type,
            occupant_count: membership.occupant_count ?? user.occupant_count,
            vehicle_count: membership.vehicle_count ?? user.vehicle_count,
            emergency_contact: membership.emergency_contact ?? user.emergency_contact,
            membership_id: membership.id,
            membership_status: membership.membership_status,
          }
        : {}),
    };

    next();
  } catch (err) {
    console.error("[authenticate] Unexpected error:", err.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};
