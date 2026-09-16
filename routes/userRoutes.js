


const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  createSocietyAdmin, createResident, createGuard,
  getResidents, updateResident, deleteResident,
  getUnassignedResidents, getGuards, updateGuard, deleteGuard,
  getMyFlat, createAccountant, getAccountant,
  updateAccountant, getMyProfile, updateMyProfile,
  forgotPassword, resetPassword,updateFCMToken,promoteToCommittee, removeCommittee, addTenantByOwner,
  removeTenantByOwner, getPendingResidents, renewTenantLease, deleteAccountant
} = require("../controllers/userControllers");

// Allow Super Admin, Admin, Committee, Accountant to view and manage residents
router.get("/resident/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getUnassignedResidents);
router.post("/societies/:societyId/admin", auth, role("SUPER_ADMIN"), createSocietyAdmin);

// Allow Super Admin to create, view, update, and delete residents
router.post("/resident", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), createResident);
router.get("/resident", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getResidents);
router.put("/resident/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), updateResident);
router.delete("/resident/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), deleteResident);

// Allow Super Admin to manage guards
router.post("/guard", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), createGuard);
router.get("/guard", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getGuards);
router.put("/guard/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), updateGuard);
router.delete("/guard/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), deleteGuard);

router.post("/resident/renew-tenant", auth, role("RESIDENT"), renewTenantLease);

// ✅ FAMILY_MEMBER needs get-flat to load their flat/society info
router.get("/get-flat", auth, role("RESIDENT", "FAMILY_MEMBER"), getMyFlat);
router.put("/fcm-token", auth, updateFCMToken);

router.put("/me", auth, updateMyProfile);

// ✅ All authenticated roles can view their own profile and permissions
router.get("/me", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT", "RESIDENT", "GUARD", "FAMILY_MEMBER"), getMyProfile);

// Allow Super Admin to manage accountant
router.post("/accountant", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createAccountant);
router.get("/accountant", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "RESIDENT"), getAccountant);
router.put("/accountant", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "RESIDENT"), updateAccountant);
router.delete("/accountant", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteAccountant);

router.post("/committee/promote", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), promoteToCommittee);
router.post("/committee/remove", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), removeCommittee);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/resident/add-tenant", auth, role("RESIDENT"), addTenantByOwner);
router.post("/resident/remove-tenant", auth, role("RESIDENT"), removeTenantByOwner);

// Pending approvals (committee & accountant can review & approve tenant applications too)
router.get(
  "/resident/pending",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  getPendingResidents
);

module.exports = router;