const { RolePermission, Society } = require("../models");

// Roles that support dynamic per-society permission overrides
const MANAGED_ROLES = ["COMMITTEE_MEMBER", "ACCOUNTANT", "GUARD", "RESIDENT", "TENANT"];

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
  maintenance: ["view", "create", "edit", "delete"],
  amenities: ["view", "create", "edit", "delete", "manage_bookings"],
  reports: ["view", "export"],
  society_documents: ["view", "upload", "edit", "delete", "download"],
  emergency: ["view", "trigger", "resolve"],
  settings: ["view", "edit"],
};

// Default baseline section enablement per role
const DEFAULT_SECTION_ENABLEMENT = {
  COMMITTEE_MEMBER: {
    dashboard: true,
    resident: true,
    property: true,
    parking_slots: true,
    flat_history: true,
    tenant_management: true,
    guard: true,
    visitor_logs: true,
    notice: true,
    complaints: true,
    accountant: true,
    manage_bills: true,
    maintenance: true,
    amenities: true,
    reports: true,
    society_documents: true,
    emergency: true,
    settings: true,
  },
  ACCOUNTANT: {
    dashboard: true,
    resident: false,
    property: false,
    parking_slots: false,
    flat_history: false,
    tenant_management: false,
    guard: false,
    visitor_logs: false,
    notice: true,
    complaints: false,
    accountant: false,
    manage_bills: true,
    maintenance: true,
    amenities: false,
    reports: true,
    society_documents: true,
    emergency: false,
    settings: true,
  },
  GUARD: {
    dashboard: true,
    resident: false,
    property: false,
    parking_slots: true,
    flat_history: false,
    tenant_management: false,
    guard: true,
    visitor_logs: true,
    notice: true,
    complaints: true,
    accountant: false,
    manage_bills: false,
    maintenance: false,
    amenities: true,
    reports: false,
    society_documents: true,
    emergency: true,
    settings: true,
  },
  RESIDENT: {
    dashboard: true,
    resident: true,
    property: true,
    parking_slots: true,
    flat_history: true,
    tenant_management: true,
    guard: true,
    visitor_logs: true,
    notice: true,
    complaints: true,
    accountant: true,
    manage_bills: true,
    maintenance: false,
    amenities: true,
    reports: true,
    society_documents: true,
    emergency: true,
    settings: true,
  },
  TENANT: {
    dashboard: true,
    resident: true,
    property: true,
    parking_slots: true,
    flat_history: true,
    tenant_management: true,
    guard: false,
    visitor_logs: true,
    notice: true,
    complaints: true,
    accountant: false,
    manage_bills: true,
    maintenance: false,
    amenities: true,
    reports: false,
    society_documents: true,
    emergency: true,
    settings: true,
  },
};

// Generate full default actions map from section enablement
const DEFAULT_PERMISSIONS = {};
Object.keys(DEFAULT_SECTION_ENABLEMENT).forEach((role) => {
  DEFAULT_PERMISSIONS[role] = {};
  Object.keys(ALL_MODULE_ACTIONS).forEach((mod) => {
    const isEnabled = DEFAULT_SECTION_ENABLEMENT[role][mod] ?? false;
    DEFAULT_PERMISSIONS[role][mod] = isEnabled ? [...ALL_MODULE_ACTIONS[mod]] : [];
  });
});

/**
 * Helper to fetch effective permissions for a role in a society
 */
const fetchEffectivePermissions = async (societyId, role) => {
  let targetRole = (role || "").toUpperCase();
  if (targetRole === "COMMITTEE") targetRole = "COMMITTEE_MEMBER";

  // Super Admin / Society Admin have full access
  if (targetRole === "SUPER_ADMIN" || targetRole === "SOCIETY_ADMIN" || targetRole === "ADMIN") {
    const fullPermissions = {};
    Object.keys(ALL_MODULE_ACTIONS).forEach((m) => {
      fullPermissions[m] = [...ALL_MODULE_ACTIONS[m]];
    });
    return fullPermissions;
  }

  // Managed roles (Committee Member, Accountant, Guard, Resident, Tenant):
  // Load per-society overrides or fall back to the role baseline
  if (MANAGED_ROLES.includes(targetRole)) {
    const overrides = societyId
      ? await RolePermission.findAll({
          where: { society_id: societyId, role: targetRole, is_active: true },
        })
      : [];

    const overrideMap = {};
    overrides.forEach((item) => {
      if (Array.isArray(item.actions)) {
        overrideMap[item.module] = item.actions.length > 0 ? [...(ALL_MODULE_ACTIONS[item.module] || item.actions)] : [];
      } else if (typeof item.actions === "boolean") {
        overrideMap[item.module] = item.actions ? [...(ALL_MODULE_ACTIONS[item.module] || [])] : [];
      }
    });

    const baseline = DEFAULT_PERMISSIONS[targetRole] || {};
    const permissionsMap = {};

    Object.keys(ALL_MODULE_ACTIONS).forEach((moduleKey) => {
      const allowedActions = overrideMap[moduleKey] !== undefined
        ? overrideMap[moduleKey]
        : (baseline[moduleKey] || []);

      permissionsMap[moduleKey] = allowedActions;
    });

    return permissionsMap;
  }

  return {};
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

    if (!MANAGED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Supported roles: ${MANAGED_ROLES.join(", ")}`,
      });
    }

    const permissionsMap = await fetchEffectivePermissions(societyId, role);

    const sectionMap = {};
    Object.keys(ALL_MODULE_ACTIONS).forEach((mod) => {
      sectionMap[mod] = Array.isArray(permissionsMap[mod]) && permissionsMap[mod].length > 0;
    });

    return res.status(200).json({
      success: true,
      role,
      society_id: societyId,
      permissions: permissionsMap,
      sections: sectionMap,
      data: {
        role,
        society_id: societyId,
        permissions: permissionsMap,
        sections: sectionMap,
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
    const { role, society_id, permissions, sections } = req.body;

    const targetRole = (role || "").toUpperCase();
    const targetSocietyId = society_id ? parseInt(society_id, 10) : req.user.society_id;

    if (!MANAGED_ROLES.includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Supported roles: ${MANAGED_ROLES.join(", ")}`,
      });
    }

    if (!targetSocietyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(400).json({
        success: false,
        message: "Society ID is required to set permissions",
      });
    }

    const inputData = sections || permissions;
    if (!inputData || typeof inputData !== "object") {
      return res.status(400).json({
        success: false,
        message: "Permissions payload must be an object of module -> boolean or actions array",
      });
    }

    // Save permissions for each module
    const moduleEntries = Object.entries(inputData);

    for (const [mod, val] of moduleEntries) {
      if (!ALL_MODULE_ACTIONS[mod]) continue;

      let isEnabled = false;
      if (typeof val === "boolean") {
        isEnabled = val;
      } else if (Array.isArray(val)) {
        isEnabled = val.length > 0;
      } else if (val === 1 || val === "true" || val === "1") {
        isEnabled = true;
      }

      const validActions = isEnabled ? [...ALL_MODULE_ACTIONS[mod]] : [];

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

    const updatedPermissions = await fetchEffectivePermissions(targetSocietyId, targetRole);

    // Emit socket event to society room for immediate client synchronization
    if (global.io) {
      global.io.to(`society_${targetSocietyId}`).emit("permissions_updated", {
        role: targetRole,
        society_id: targetSocietyId,
        permissions: updatedPermissions,
      });
      global.io.emit("role_permissions_changed", {
        role: targetRole,
        society_id: targetSocietyId,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Permissions for ${targetRole} updated successfully`,
      role: targetRole,
      society_id: targetSocietyId,
      permissions: updatedPermissions,
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

    const requestedRole = req.query.role || req.headers["x-active-role"];
    let activeRole = (requestedRole || user.activeRole || user.role || "RESIDENT").toUpperCase();
    if (activeRole === "COMMITTEE") activeRole = "COMMITTEE_MEMBER";
    const societyId = user.society_id;

    const userPermissions = await fetchEffectivePermissions(societyId, activeRole);
    const isFullAdmin = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ADMIN"].includes(activeRole);

    return res.status(200).json({
      success: true,
      role: activeRole,
      isFullAdmin,
      permissions: userPermissions,
      dynamic_permissions: userPermissions,
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
      modules: ALL_MODULE_ACTIONS,
      defaults: DEFAULT_PERMISSIONS,
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
  fetchEffectivePermissions,
  getRolePermissions,
  updateRolePermissions,
  getMyPermissions,
  getModulesCatalog,
  DEFAULT_PERMISSIONS,
  ALL_MODULE_ACTIONS,
  MANAGED_ROLES,
};

