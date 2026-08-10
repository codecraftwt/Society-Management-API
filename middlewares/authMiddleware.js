
const jwt = require("jsonwebtoken");
const User = require("../models/User");

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

    // 🔥 ALWAYS TAKE ROLES FROM DB (NOT TOKEN)
    const roles = user.roles && user.roles.length > 0
      ? user.roles
      : [user.role];

    // 🔥 activeRole still from token (user-selected role)
    const activeRole = decoded.activeRole && roles.includes(decoded.activeRole)
      ? decoded.activeRole
      : roles[0];

    req.user = {
      ...user.toJSON(),
      roles,
      activeRole,
    };

    next();
  } catch (err) {
    console.error("[authenticate] Unexpected error:", err.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};