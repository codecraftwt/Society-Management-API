const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

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
  getVisitorReport
);


/* === COMPLAINT REPORT === */
router.get(
  "/complaints",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  getComplaintReport
);


/* === FINANCIAL REPORT === */
router.get(
  "/financial",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"),
  getFinancialReport
);

module.exports = router;
