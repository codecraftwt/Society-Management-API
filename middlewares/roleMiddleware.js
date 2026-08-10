


module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { activeRole } = req.user;

    // 🔥 GLOBAL BYPASS: Super Admin has absolute access to everything
    if (req.user.activeRole === "SUPER_ADMIN" && req.headers["x-society-id"]) {
      req.user.society_id = parseInt(req.headers["x-society-id"], 10);
      return next();
    }

    if (!allowedRoles.includes(activeRole)) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${allowedRoles.join(", ")}. Your active role: ${activeRole}`,
      });
    }

    next();
  };
};