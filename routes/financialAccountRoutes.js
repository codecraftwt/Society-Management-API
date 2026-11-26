const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  listAccounts,
  createAccount,
  updateAccount,
  toggleAccountStatus,
  recordCashEntry,
  transferBetweenAccounts,
  reconcileAccounts,
} = require("../controllers/financialAccountControllers");

const financeRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"];

router.use(auth, role(...financeRoles));

router.get("/", checkPermission("accounting", "view"), listAccounts);
router.post("/", checkPermission("accounting", "create"), createAccount);
router.put("/:id", checkPermission("accounting", "edit"), updateAccount);
router.patch("/:id/status", checkPermission("accounting", "edit"), toggleAccountStatus);
router.post("/cash-entry", checkPermission("accounting", "create"), recordCashEntry);
router.post("/transfer", checkPermission("accounting", "create"), transferBetweenAccounts);
router.get("/reconcile", checkPermission("accounting", "view_ledger"), reconcileAccounts);

module.exports = router;
