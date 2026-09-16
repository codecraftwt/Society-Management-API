const router = require("express").Router();
const authMiddleware = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  approveResident,
  rejectResident,
  getTenantHistory,
} = require("../controllers/adminControllers");

// Tenant approval & history — gated dynamically
router.put("/approve-resident/:userId", authMiddleware, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("tenant_management", "approve"), approveResident);
router.put("/reject-resident/:userId", authMiddleware, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("tenant_management", "reject"), rejectResident);
router.get("/tenant-history", authMiddleware, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("tenant_management", "view"), getTenantHistory);

module.exports = router;
