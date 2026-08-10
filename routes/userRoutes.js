


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
  removeTenantByOwner, getPendingResidents, approveResident, renewTenantLease, deleteAccountant
} = require("../controllers/userControllers");

// Allow Super Admin to view unassigned residents too
router.get("/resident/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getUnassignedResidents);
router.post("/societies/:societyId/admin", auth, role("SUPER_ADMIN"), createSocietyAdmin);

// Allow Super Admin to create, view, update, and delete residents
router.post("/resident", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), createResident);
router.get("/resident", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getResidents);
router.put("/resident/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), updateResident);
router.delete("/resident/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), deleteResident);

// Allow Super Admin to manage guards
router.post("/guard", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createGuard);
router.get("/guard", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getGuards);
router.put("/guard/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateGuard);
router.delete("/guard/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteGuard);

router.post("/resident/renew-tenant", auth, role("RESIDENT"), renewTenantLease);

// ✅ FAMILY_MEMBER needs get-flat to load their flat/society info
router.get("/get-flat", auth, role("RESIDENT", "FAMILY_MEMBER"), getMyFlat);
router.put("/fcm-token", auth, updateFCMToken);

router.put("/me", auth, updateMyProfile);

// ✅ FAMILY_MEMBER can view their own profile
router.get("/me", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "RESIDENT", "GUARD", "FAMILY_MEMBER"), getMyProfile);

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

// Pending approvals
router.get(
  "/resident/pending", 
  auth, 
  role("SUPER_ADMIN", "SOCIETY_ADMIN"), 
  getPendingResidents
);

// Route to approve a specific resident
router.put(
  "/resident/:userId/approve", 
  auth, 
  role("SUPER_ADMIN", "SOCIETY_ADMIN"), 
  approveResident
);

module.exports = router;