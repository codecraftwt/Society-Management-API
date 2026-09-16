

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { createEmergency, getEmergencyAlerts, resolveEmergency, getActiveEmergencies, getMyEmergencies } = require("../controllers/emergencyControllers");

const ALL_SOCIETY_ROLES = ["GUARD", "RESIDENT", "FAMILY_MEMBER", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ADMIN", "SUPER_ADMIN", "ACCOUNTANT"];

// ✅ All roles can post emergency alerts
router.post("/", auth, role(...ALL_SOCIETY_ROLES), createEmergency);

// ✅ All roles in society can view alerts
router.get("/", auth, role(...ALL_SOCIETY_ROLES), getEmergencyAlerts);

// ✅ All roles can view active emergencies
router.get("/active", auth, role(...ALL_SOCIETY_ROLES), getActiveEmergencies);

// ✅ All roles (including Residents and Committee Members) can mark as read / resolve emergency alerts
router.patch("/:id/resolve", auth, role(...ALL_SOCIETY_ROLES), resolveEmergency);
router.put("/:id/resolve", auth, role(...ALL_SOCIETY_ROLES), resolveEmergency);

router.get("/mine", auth, role("RESIDENT", "FAMILY_MEMBER", "COMMITTEE_MEMBER", "GUARD", "SOCIETY_ADMIN", "ADMIN"), getMyEmergencies);

module.exports = router;
