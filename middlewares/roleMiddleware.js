module.exports = (...allowedRoles) => {
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
      userRoles.add("RESIDENT");
    }
    if (userRoles.has("COMMITTEE_MEMBER") || userRoles.has("COMMITTEE")) {
      userRoles.add("RESIDENT");
    }

    // Dynamic RBAC: If route permits administrative roles (SOCIETY_ADMIN or COMMITTEE_MEMBER), also allow ACCOUNTANT through
    // so downstream permission checks (checkPermission) can validate their dynamic permissions.
    if ((allowedRoles.includes("COMMITTEE_MEMBER") || allowedRoles.includes("SOCIETY_ADMIN") || allowedRoles.includes("ADMIN")) && userRoles.has("ACCOUNTANT")) {
      userRoles.add("COMMITTEE_MEMBER");
      userRoles.add("SOCIETY_ADMIN");
    }

    const hasAccess = allowedRoles.some((r) => userRoles.has(r));

    if (!hasAccess) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${allowedRoles.join(", ")}. Your roles: ${Array.from(userRoles).join(", ")}`,
      });
    }

    next();
  };
};