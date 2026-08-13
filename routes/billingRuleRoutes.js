const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  getBillingRules,
  createBillingRule,
  deleteBillingRule,
} = require("../controllers/billingRuleControllers");

router.get("/", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getBillingRules);
router.post("/", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), createBillingRule);
router.delete("/:id", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), deleteBillingRule);

module.exports = router;
