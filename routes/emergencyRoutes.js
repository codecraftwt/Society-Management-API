

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { createEmergency, getEmergencyAlerts, resolveEmergency, getActiveEmergencies,getMyEmergencies } = require("../controllers/emergencyControllers");

// ✅ FAMILY_MEMBER can POST emergency alerts
router.post("/", auth, role("GUARD", "RESIDENT", "FAMILY_MEMBER"), createEmergency);

// Admin / Guard — view all alerts
router.get("/", auth, role("SOCIETY_ADMIN", "GUARD"), getEmergencyAlerts);

// ✅ FAMILY_MEMBER can view active emergencies
router.get("/active", auth, role("SOCIETY_ADMIN", "RESIDENT", "GUARD", "FAMILY_MEMBER", "COMMITTEE_MEMBER"), getActiveEmergencies);

// Admin only — resolve
router.patch("/:id/resolve", auth, role("SOCIETY_ADMIN"), resolveEmergency);

router.get("/mine", auth, role("RESIDENT", "FAMILY_MEMBER"), getMyEmergencies);

module.exports = router;
