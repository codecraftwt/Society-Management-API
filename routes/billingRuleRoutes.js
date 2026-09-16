const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
const {
  getBillingRules,
  createBillingRule,
  deleteBillingRule,
} = require("../controllers/billingRuleControllers");

router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("manage_bills", "view"), getBillingRules);
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("manage_bills", "create"), createBillingRule);
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("manage_bills", "delete"), deleteBillingRule);

module.exports = router;
