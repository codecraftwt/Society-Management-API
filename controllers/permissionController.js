const { RolePermission, Society } = require("../models");

// Default baseline permissions matrix
const DEFAULT_PERMISSIONS = {
  COMMITTEE_MEMBER: {
    dashboard: ["view"],
    resident: ["view"],
    property: ["view"],
    parking_slots: ["view", "allocate", "release"],
    flat_history: ["view"],
    tenant_management: ["view", "approve", "reject"],
    guard: ["view", "edit_shift"],
    visitor_logs: ["view"],
    notice: ["view", "create", "edit_own", "delete_own"],
    complaints: ["view", "discuss", "update_status"],
    accountant: ["view"],
    manage_bills: ["view"],
    amenities: ["view", "manage_bookings"],
    reports: ["view"],
    society_documents: ["view", "download"],
    emergency: ["view", "trigger", "resolve"],
    settings: ["view", "edit"],
  },
  ACCOUNTANT: {
    dashboard: ["view"],
    resident: ["view", "view_directory"],
    property: ["view"],
    parking_slots: ["view"],
    flat_history: ["view"],
    tenant_management: ["view"],
    guard: ["view"],
    visitor_logs: ["view"],
    notice: ["view"],
    complaints: ["view"],
    accountant: ["view"],
    manage_bills: ["view", "create", "edit", "delete", "generate"],
    amenities: ["view"],
    reports: ["view", "export"],
    society_documents: ["view", "download"],
    emergency: ["view"],
    settings: ["view", "edit_profile"],
  },
};

const ALL_MODULE_ACTIONS = {
  dashboard: ["view"],
  resident: ["view", "create", "edit", "delete", "promote", "status"],
  property: ["view", "create", "edit", "delete"],
  parking_slots: ["view", "create_slot", "edit_slot", "delete_slot", "allocate", "release"],
  flat_history: ["view"],
  tenant_management: ["view", "approve", "reject"],
  guard: ["view", "create", "edit", "delete", "edit_shift"],
  visitor_logs: ["view", "create", "checkin", "checkout"],
  notice: ["view", "create", "edit", "delete"],
  complaints: ["view", "create", "discuss", "update_status"],
  accountant: ["view", "create", "edit", "toggle_status", "appoint"],
  manage_bills: ["view", "create", "edit", "delete", "generate"],
  amenities: ["view", "create", "edit", "delete", "manage_bookings"],
  reports: ["view", "export"],
  society_documents: ["view", "upload", "edit", "delete", "download"],
  emergency: ["view", "trigger", "resolve"],
  settings: ["view", "edit"],
};

/**
 * Get effective permissions for a role in a society
 * GET /api/permissions?role=COMMITTEE_MEMBER&society_id=1
 */
const getRolePermissions = async (req, res) => {
  try {
    const role = (req.query.role || "COMMITTEE_MEMBER").toUpperCase();
    const societyId = req.query.society_id
      ? parseInt(req.query.society_id, 10)
      : req.user.society_id || null;

    if (!["COMMITTEE_MEMBER", "ACCOUNTANT"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Supported roles: COMMITTEE_MEMBER, ACCOUNTANT",
      });
    }

    // Fetch DB overrides for this society & role
    const overrides = societyId
      ? await RolePermission.findAll({
          where: { society_id: societyId, role, is_active: true },
        })
      : [];

    const overrideMap = {};
    overrides.forEach((item) => {
      overrideMap[item.module] = Array.isArray(item.actions) ? item.actions : [];
    });

    const baseline = DEFAULT_PERMISSIONS[role] || {};
    const permissionsMap = {};

    Object.keys(ALL_MODULE_ACTIONS).forEach((moduleKey) => {
      const allowedActions = overrideMap[moduleKey] !== undefined
        ? overrideMap[moduleKey]
        : (baseline[moduleKey] || []);

      permissionsMap[moduleKey] = allowedActions;
    });

    return res.status(200).json({
      success: true,
      role,
      society_id: societyId,
      permissions: permissionsMap,
      data: {
        role,
        society_id: societyId,
        permissions: permissionsMap,
        modules: ALL_MODULE_ACTIONS,
        defaults: DEFAULT_PERMISSIONS,
      },
      availableModules: ALL_MODULE_ACTIONS,
    });
  } catch (error) {
    console.error("getRolePermissions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch role permissions",
      error: error.message,
    });
  }
};

/**
 * Update dynamic permissions for a role in a society
 * POST /api/permissions/update
 */
const updateRolePermissions = async (req, res) => {
  try {
    const { role, society_id, permissions } = req.body;

    const targetRole = (role || "").toUpperCase();
    const targetSocietyId = society_id ? parseInt(society_id, 10) : req.user.society_id;

    if (!["COMMITTEE_MEMBER", "ACCOUNTANT"].includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Supported roles: COMMITTEE_MEMBER, ACCOUNTANT",
      });
    }

    if (!targetSocietyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(400).json({
        success: false,
        message: "Society ID is required to set permissions",
      });
    }

    if (!permissions || typeof permissions !== "object") {
      return res.status(400).json({
        success: false,
        message: "Permissions payload must be an object of module -> actions array",
      });
    }

    // Save permissions for each module
    const moduleEntries = Object.entries(permissions);

    for (const [mod, actions] of moduleEntries) {
      const validActions = Array.isArray(actions)
        ? actions.filter((a) => (ALL_MODULE_ACTIONS[mod] || []).includes(a))
        : [];

      const [existing] = await RolePermission.findOrCreate({
        where: {
          society_id: targetSocietyId,
          role: targetRole,
          module: mod,
        },
        defaults: {
          society_id: targetSocietyId,
          role: targetRole,
          module: mod,
          actions: validActions,
          is_active: true,
        },
      });

      if (existing) {
        existing.actions = validActions;
        existing.is_active = true;
        await existing.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: `Permissions for ${targetRole} updated successfully`,
      role: targetRole,
      society_id: targetSocietyId,
    });
  } catch (error) {
    console.error("updateRolePermissions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update role permissions",
      error: error.message,
    });
  }
};

/**
 * Get current user's effective permissions
 * GET /api/permissions/my
 */
const getMyPermissions = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const activeRole = (user.activeRole || user.role || "RESIDENT").toUpperCase();
    const societyId = user.society_id;

    // Super Admin and Society Admin have full rights
    if (activeRole === "SUPER_ADMIN" || activeRole === "SOCIETY_ADMIN" || activeRole === "ADMIN") {
      const fullPermissions = {};
      Object.keys(ALL_MODULE_ACTIONS).forEach((m) => {
        fullPermissions[m] = ALL_MODULE_ACTIONS[m];
      });
      return res.status(200).json({
        success: true,
        role: activeRole,
        isFullAdmin: true,
        permissions: fullPermissions,
      });
    }

    // If Committee Member or Accountant, load dynamic society overrides
    if (["COMMITTEE_MEMBER", "ACCOUNTANT"].includes(activeRole)) {
      const overrides = societyId
        ? await RolePermission.findAll({
            where: { society_id: societyId, role: activeRole, is_active: true },
          })
        : [];

      const overrideMap = {};
      overrides.forEach((item) => {
        overrideMap[item.module] = Array.isArray(item.actions) ? item.actions : [];
      });

      const baseline = DEFAULT_PERMISSIONS[activeRole] || {};
      const userPermissions = {};

      Object.keys(ALL_MODULE_ACTIONS).forEach((mod) => {
        userPermissions[mod] = overrideMap[mod] !== undefined
          ? overrideMap[mod]
          : (baseline[mod] || []);
      });

      return res.status(200).json({
        success: true,
        role: activeRole,
        isFullAdmin: false,
        permissions: userPermissions,
      });
    }

    // Other roles: Resident, Guard, Family Member (return default mapping)
    return res.status(200).json({
      success: true,
      role: activeRole,
      isFullAdmin: false,
      permissions: {},
    });
  } catch (error) {
    console.error("getMyPermissions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user permissions",
      error: error.message,
    });
  }
};

/**
 * Get catalog of all system modules and supported actions
 * GET /api/permissions/modules
 */
const getModulesCatalog = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        modules: ALL_MODULE_ACTIONS,
        defaults: DEFAULT_PERMISSIONS,
      },
    });
  } catch (error) {
    console.error("getModulesCatalog error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch modules catalog",
      error: error.message,
    });
  }
};

module.exports = {
  getRolePermissions,
  updateRolePermissions,
  getMyPermissions,
  getModulesCatalog,
  DEFAULT_PERMISSIONS,
  ALL_MODULE_ACTIONS,
};
