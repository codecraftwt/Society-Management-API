const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const enforceRulesAcknowledged = require("../middlewares/enforceRulesAcknowledged");

const { createPreApproval,verifyGatePass, getMyGatePasses } = require("../controllers/preApprovalControllers");

// Resident creates preapproval
router.post("/", auth, role("RESIDENT", "FAMILY_MEMBER"), enforceRulesAcknowledged, createPreApproval);
router.post("/verify", auth, role("GUARD", "FAMILY_MEMBER"), verifyGatePass);

router.get("/my", auth, role("RESIDENT", "FAMILY_MEMBER"), getMyGatePasses);

module.exports = router;
