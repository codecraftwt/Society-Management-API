const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  getVisitorReport,
  getComplaintReport,
  getFinancialReport,
  getPaymentReport,
  getExpenseReport,
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


/* === PAYMENT REPORT (money-in, from `payments`) === */
router.get(
  "/payments",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("reports", "view"),
  getPaymentReport
);


/* === EXPENSE REPORT (money-out, from `expenses`) === */
router.get(
  "/expenses",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("reports", "view"),
  getExpenseReport
);

module.exports = router;

