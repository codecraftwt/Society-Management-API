const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  getVisitorReport,
  getComplaintReport,
  getFinancialReport,
} = require("../controllers/reportControllers");


/* === VISITOR REPORT === */
router.get(
  "/visitors",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  checkPermission("reports", "view"),
  getVisitorReport
);


/* === COMPLAINT REPORT === */
router.get(
  "/complaints",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  checkPermission("reports", "view"),
  getComplaintReport
);


/* === FINANCIAL REPORT === */
router.get(
  "/financial",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("reports", "view"),
  getFinancialReport
);

module.exports = router;

