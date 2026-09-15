
const ADMIN_ROLES = ["SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"];

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const activeRole = req.user.activeRole;
  const userRoles = new Set(req.user.roles || []);
  if (req.user.role) userRoles.add(req.user.role);
  if (activeRole) userRoles.add(activeRole);
  if (req.user.is_committee_member || req.user.is_committee) userRoles.add("COMMITTEE_MEMBER");

  const hasAccess = ADMIN_ROLES.some((r) => userRoles.has(r));
  if (hasAccess) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `Access denied. Requires one of: ${ADMIN_ROLES.join(", ")}`,
  });
};