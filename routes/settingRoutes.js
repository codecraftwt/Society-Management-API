const express = require("express");
const router  = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { getSettings, updateSettings } = require("../controllers/settingsController");

// Any logged-in resident / family member / guard can manage their own settings
router.get("/", auth, role("RESIDENT", "FAMILY_MEMBER", "GUARD", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getSettings);
router.put("/", auth, role("RESIDENT", "FAMILY_MEMBER", "GUARD", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), updateSettings);

module.exports = router;