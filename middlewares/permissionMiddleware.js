const { RolePermission } = require("../models");
const { DEFAULT_PERMISSIONS, ALL_MODULE_ACTIONS } = require("../controllers/permissionController");

/**
 * Dynamic Permission Enforcement Middleware
 * Usage: router.post("/bills", checkPermission("manage_bills", "create"), createBill);
 * @param {string} module - Module identifier (e.g. 'manage_bills', 'amenities', 'resident', 'notice')
 * @param {string} action - Action identifier (e.g. 'view', 'create', 'edit', 'delete', 'approve', 'generate')
 */
const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      const activeRole = (req.user.activeRole || req.user.role || "").toUpperCase();
      const userRoles = new Set((req.user.roles || []).map((r) => String(r).toUpperCase()));
      if (req.user.role) userRoles.add(req.user.role.toUpperCase());
      if (activeRole) userRoles.add(activeRole);
      if (req.user.is_committee_member || req.user.is_committee) {
        userRoles.add("COMMITTEE_MEMBER");
      }

      // 1. SUPER ADMIN GLOBAL BYPASS
      if (userRoles.has("SUPER_ADMIN") || activeRole === "SUPER_ADMIN") {
        return next();
      }

      // 2. SOCIETY ADMIN / ADMIN FULL ACCESS
      if (userRoles.has("SOCIETY_ADMIN") || userRoles.has("ADMIN") || activeRole === "SOCIETY_ADMIN") {
        return next();
      }

      // 3. COMMITTEE MEMBER OR ACCOUNTANT DYNAMIC PERMISSION CHECK
      const checkRole =
        activeRole === "COMMITTEE_MEMBER"
          ? "COMMITTEE_MEMBER"
          : activeRole === "ACCOUNTANT"
          ? "ACCOUNTANT"
          : userRoles.has("COMMITTEE_MEMBER")
          ? "COMMITTEE_MEMBER"
          : userRoles.has("ACCOUNTANT")
          ? "ACCOUNTANT"
          : null;

      if (checkRole) {
        const societyId = req.user.society_id;

        // Fetch DB override if available
        let grantedActions = null;

        if (societyId) {
          const dbPermission = await RolePermission.findOne({
            where: {
              society_id: societyId,
              role: checkRole,
              module,
              is_active: true,
            },
          });

          if (dbPermission) {
            if (Array.isArray(dbPermission.actions)) {
              grantedActions = dbPermission.actions;
            } else if (typeof dbPermission.actions === "boolean") {
              grantedActions = dbPermission.actions ? (ALL_MODULE_ACTIONS[module] || []) : [];
            }
          }
        }

        // Fallback to default matrix
        if (grantedActions === null) {
          const roleDefaults = DEFAULT_PERMISSIONS[checkRole] || {};
          grantedActions = roleDefaults[module] || [];
        }

        const effectiveActions = Array.isArray(grantedActions) ? grantedActions : [];

        // If no specific action required or view action requested, check if module has any permitted actions
        if (!action) {
          if (effectiveActions.length > 0) return next();
        } else if (effectiveActions.includes(action) || (effectiveActions.length > 0 && action === "view")) {
          return next();
        }

        return res.status(403).json({
          success: false,
          code: "PERMISSION_DENIED",
          message: `Access denied. You don't have permission for ${action || "access"} on module '${module}'.`,
          required: { module, action },
        });
      }

      // 4. Default: Role not authorized for this admin-level module
      return res.status(403).json({
        success: false,
        code: "PERMISSION_DENIED",
        message: `You don't have permission to perform this action: ${action} on ${module}`,
      });
    } catch (error) {
      console.error("checkPermission middleware error:", error);
      return res.status(500).json({
        success: false,
        message: "Permission check failed",
        error: error.message,
      });
    }
  };
};

module.exports = {
  checkPermission,
};
