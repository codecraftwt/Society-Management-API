const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware");
const {
  getRolePermissions,
  updateRolePermissions,
  getMyPermissions,
  getModulesCatalog,
} = require("../controllers/permissionController");

// Available modules & default permissions catalog
router.get("/modules", authMiddleware, getModulesCatalog);

// Any authenticated user can get their own permissions
router.get("/my", authMiddleware, getMyPermissions);

// Super Admin and Society Admin can view and manage dynamic role permissions
router.get("/", authMiddleware, adminMiddleware, getRolePermissions);
router.post("/update", authMiddleware, adminMiddleware, updateRolePermissions);

module.exports = router;
