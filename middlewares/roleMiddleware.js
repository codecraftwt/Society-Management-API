const createRoleMiddleware = (allowedRoles, { allowAdminEscalation = true, useActiveRole = false } = {}) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { activeRole, roles, role, is_committee_member, is_committee } = req.user;

    // 🔥 GLOBAL BYPASS: Super Admin has absolute access to everything
    const targetSocId = req.headers["x-society-id"] || req.query?.society_id || req.body?.society_id;
    const isSuperAdmin = activeRole === "SUPER_ADMIN" || role === "SUPER_ADMIN" || (roles && roles.includes("SUPER_ADMIN"));
    if (isSuperAdmin) {
      if (targetSocId && targetSocId !== "ALL") {
        req.user.society_id = parseInt(targetSocId, 10);
      }
      return next();
    }

    const userRoles = new Set(roles || []);
    if (role) userRoles.add(role);
    if (activeRole) userRoles.add(activeRole);
    if (is_committee_member || is_committee) {
      userRoles.add("COMMITTEE_MEMBER");
      userRoles.add("COMMITTEE");
    }
    if (userRoles.has("SOCIETY_ADMIN")) {
      userRoles.add("COMMITTEE_MEMBER");
    }

    // Residency access: If the user is a verified resident of the society, grant RESIDENT role
    // regardless of whether they are a Society Admin, Committee Member, or Accountant.
    if (req.user.is_society_resident === true || req.user.can_switch_to_resident === true) {
      userRoles.add("RESIDENT");
    } else if (req.user.is_society_resident === false) {
      // Confirmed outsider: only remove RESIDENT if user is an outsider admin/accountant
      if (userRoles.has("SOCIETY_ADMIN") || userRoles.has("ACCOUNTANT")) {
        userRoles.delete("RESIDENT");
      }
    } else if ((userRoles.has("COMMITTEE_MEMBER") || userRoles.has("COMMITTEE")) && !userRoles.has("SOCIETY_ADMIN")) {
      userRoles.add("RESIDENT");
    }

    // Dynamic RBAC: If route permits administrative roles (SOCIETY_ADMIN or COMMITTEE_MEMBER), also allow ACCOUNTANT through
    // so downstream permission checks (checkPermission) can validate their dynamic permissions.
    // Strict routes opt out so a role list can never silently grant accountant access.
    if (
      allowAdminEscalation &&
      (allowedRoles.includes("COMMITTEE_MEMBER") || allowedRoles.includes("SOCIETY_ADMIN") || allowedRoles.includes("ADMIN")) &&
      userRoles.has("ACCOUNTANT")
    ) {
      userRoles.add("COMMITTEE_MEMBER");
      userRoles.add("SOCIETY_ADMIN");
    }

    const effectiveRoles =
      useActiveRole && activeRole
        ? new Set([String(activeRole).toUpperCase()])
        : userRoles;
    const hasAccess = allowedRoles.some((r) => effectiveRoles.has(r));

    if (!hasAccess) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${allowedRoles.join(", ")}. Your roles: ${Array.from(effectiveRoles).join(", ")}`,
      });
    }

    next();
  };
};

const role = (...allowedRoles) => createRoleMiddleware(allowedRoles);
role.strict = (...allowedRoles) => createRoleMiddleware(allowedRoles, { allowAdminEscalation: false });
role.active = (...allowedRoles) =>
  createRoleMiddleware(allowedRoles, { allowAdminEscalation: false, useActiveRole: true });

module.exports = role;
