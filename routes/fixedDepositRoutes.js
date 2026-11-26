const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  listFixedDeposits,
  getFixedDepositDetail,
  createFixedDeposit,
  updateFixedDeposit,
  recordInterestPayout,
  closeOrMatureFixedDeposit,
} = require("../controllers/fixedDepositControllers");

const financeRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"];

router.use(auth, role(...financeRoles));

router.get("/", checkPermission("accounting", "view"), listFixedDeposits);
router.get("/:id", checkPermission("accounting", "view"), getFixedDepositDetail);
router.post("/", checkPermission("accounting", "create"), createFixedDeposit);
router.put("/:id", checkPermission("accounting", "edit"), updateFixedDeposit);
router.post("/:id/interest-payout", checkPermission("accounting", "edit"), recordInterestPayout);
router.post("/:id/mature", checkPermission("accounting", "edit"), closeOrMatureFixedDeposit);

module.exports = router;
