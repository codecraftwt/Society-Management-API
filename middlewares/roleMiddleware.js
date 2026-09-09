module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { activeRole, roles, role, is_committee_member, is_committee } = req.user;

    // 🔥 GLOBAL BYPASS: Super Admin has absolute access to everything
    if (activeRole === "SUPER_ADMIN" && req.headers["x-society-id"]) {
      req.user.society_id = parseInt(req.headers["x-society-id"], 10);
      return next();
    }
    if (activeRole === "SUPER_ADMIN" || role === "SUPER_ADMIN" || (roles && roles.includes("SUPER_ADMIN"))) {
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

    const hasAccess = allowedRoles.some((r) => userRoles.has(r));

    if (!hasAccess) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${allowedRoles.join(", ")}. Your roles: ${Array.from(userRoles).join(", ")}`,
      });
    }

    next();
  };
};