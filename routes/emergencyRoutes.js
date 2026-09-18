

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  createEmergency,
  getEmergencyAlerts,
  getEmergencyById,
  getEmergencyAcknowledgements,
  markEmergencyAsRead,
  resolveEmergency,
  updateEmergency,
  deleteEmergency,
  getActiveEmergencies,
  getMyEmergencies,
} = require("../controllers/emergencyControllers");

const ALL_SOCIETY_ROLES = [
  "GUARD",
  "RESIDENT",
  "FAMILY_MEMBER",
  "SOCIETY_ADMIN",
  "COMMITTEE_MEMBER",
  "ADMIN",
  "SUPER_ADMIN",
  "ACCOUNTANT",
  "TENANT",
];

const MANAGEMENT_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "SOCIETY_ADMIN",
  "COMMITTEE_MEMBER",
  "GUARD",
  "ACCOUNTANT",
];

// ✅ All roles can post emergency alerts
router.post("/", auth, role(...ALL_SOCIETY_ROLES), createEmergency);

// ✅ All roles in society can view alerts
router.get("/", auth, role(...ALL_SOCIETY_ROLES), getEmergencyAlerts);

// ✅ Active emergencies
router.get("/active", auth, role(...ALL_SOCIETY_ROLES), getActiveEmergencies);

// ✅ Resident's own emergency history
router.get("/mine", auth, role(...ALL_SOCIETY_ROLES), getMyEmergencies);

// ✅ Acknowledgements / Read history (Admin, Committee, Guard)
router.get("/:id/acknowledgements", auth, role(...MANAGEMENT_ROLES), getEmergencyAcknowledgements);
router.get("/:id/read-history", auth, role(...MANAGEMENT_ROLES), getEmergencyAcknowledgements);

// ✅ Mark as Read / Acknowledge receipt
router.patch("/:id/read", auth, role(...ALL_SOCIETY_ROLES), markEmergencyAsRead);
router.post("/:id/read", auth, role(...ALL_SOCIETY_ROLES), markEmergencyAsRead);
router.patch("/:id/acknowledge", auth, role(...ALL_SOCIETY_ROLES), markEmergencyAsRead);

// ✅ Resolve emergency
router.patch("/:id/resolve", auth, role(...ALL_SOCIETY_ROLES), resolveEmergency);
router.put("/:id/resolve", auth, role(...ALL_SOCIETY_ROLES), resolveEmergency);

// ✅ Single emergency details
router.get("/:id", auth, role(...ALL_SOCIETY_ROLES), getEmergencyById);

// ✅ Update emergency details (Staff / Management)
router.put("/:id", auth, role(...MANAGEMENT_ROLES), updateEmergency);
router.patch("/:id", auth, role(...MANAGEMENT_ROLES), updateEmergency);

// ✅ Delete emergency (Admin / Super Admin / Committee)
router.delete("/:id", auth, role("SUPER_ADMIN", "ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), deleteEmergency);

module.exports = router;

