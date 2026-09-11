const router = require("express").Router();
const authMiddleware = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  approveResident,
  rejectResident,
  getTenantHistory,
} = require("../controllers/adminControllers");

// Tenant approval & history — SOCIETY_ADMIN + COMMITTEE_MEMBER (SUPER_ADMIN bypasses via roleMiddleware)
router.put("/approve-resident/:userId", authMiddleware, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), approveResident);
router.put("/reject-resident/:userId", authMiddleware, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), rejectResident);
router.get("/tenant-history", authMiddleware, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getTenantHistory);

module.exports = router;
