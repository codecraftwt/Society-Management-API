const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  getBalance,
  getLedger,
  setOpeningBalance,
  getSocietiesOverview,
  getChartData,
  getAuditLogs,
} = require("../controllers/accountingControllers");

const financeRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"];

router.use(auth, role(...financeRoles));

/* ==== ACCOUNT / LEDGER ==== */
router.get("/balance", checkPermission("accounting", "view"), getBalance);
router.get("/ledger", checkPermission("accounting", "view_ledger"), getLedger);
router.put("/opening-balance", checkPermission("accounting", "manage_opening_balance"), setOpeningBalance);
router.get("/audit-logs", checkPermission("accounting", "view_ledger"), getAuditLogs);

/* ==== DASHBOARD CHARTS ==== */
router.get("/chart", checkPermission("accounting", "view_reports"), getChartData);
router.get("/societies", checkPermission("accounting", "view_reports"), getSocietiesOverview);

module.exports = router;