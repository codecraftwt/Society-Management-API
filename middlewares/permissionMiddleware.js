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

      // 2. SOCIETY ADMIN / ADMIN / COMMITTEE MEMBER FULL ACCESS
      if (
        userRoles.has("SOCIETY_ADMIN") ||
        userRoles.has("ADMIN") ||
        userRoles.has("COMMITTEE_MEMBER") ||
        userRoles.has("COMMITTEE") ||
        activeRole === "SOCIETY_ADMIN" ||
        activeRole === "COMMITTEE_MEMBER" ||
        activeRole === "COMMITTEE"
      ) {
        return next();
      }

      // 2.1. GUARD OPERATIONAL VIEW ACCESS (for gate management such as parking slots & visitor logs)
      if ((userRoles.has("GUARD") || activeRole === "GUARD") && (action === "view" || !action)) {
        return next();
      }

      // 3. ACCOUNTANT DYNAMIC PERMISSION CHECK
      const checkRole =
        activeRole === "ACCOUNTANT"
          ? "ACCOUNTANT"
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

        // Check action permission with sub-action compatibility (e.g. edit_shift under edit)
        const hasActionPermission =
          !action ||
          effectiveActions.includes(action) ||
          (action === "view" && effectiveActions.length > 0) ||
          (action === "edit_shift" && (effectiveActions.includes("edit") || effectiveActions.includes("edit_shift"))) ||
          (action === "create_slot" && (effectiveActions.includes("create") || effectiveActions.includes("create_slot"))) ||
          (action === "edit_slot" && (effectiveActions.includes("edit") || effectiveActions.includes("edit_slot"))) ||
          (action === "delete_slot" && (effectiveActions.includes("delete") || effectiveActions.includes("delete_slot"))) ||
          (action === "allocate" && (effectiveActions.includes("edit") || effectiveActions.includes("allocate"))) ||
          (action === "release" && (effectiveActions.includes("edit") || effectiveActions.includes("release")));

        if (hasActionPermission) {
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
