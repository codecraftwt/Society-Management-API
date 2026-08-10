
const ADMIN_ROLES = ["SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"];

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  if (ADMIN_ROLES.includes(req.user.activeRole)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `Access denied. Requires one of: ${ADMIN_ROLES.join(", ")}`,
  });
};