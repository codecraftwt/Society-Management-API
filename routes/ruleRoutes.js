const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const upload = require("../middlewares/uploadNotice"); // Reusable Cloudinary upload factory

const {
  getRules,
  getPendingRules,
  getRuleById,
  createRule,
  updateRule,
  publishRuleVersion,
  archiveRule,
  acknowledgeRules,
  getRuleAcknowledgements,
  streamRuleDocument,
} = require("../controllers/ruleControllers");

// ── Authenticated Routes ──
router.get("/pending", auth, getPendingRules);
router.get("/version/:versionId/document", auth, streamRuleDocument);
router.get("/:id/acknowledgements", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getRuleAcknowledgements);
router.get("/:id", auth, getRuleById);
router.get("/", auth, getRules);

// Write routes (Super Admin and Society Admin)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), upload("rules").single("file"), createRule);
router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateRule);
router.post("/:id/versions", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), upload("rules").single("file"), publishRuleVersion);
router.patch("/:id/archive", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), archiveRule);

// Acknowledgement route (Residents)
router.post("/acknowledge", auth, acknowledgeRules);

module.exports = router;

