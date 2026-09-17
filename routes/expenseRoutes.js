const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  voidExpense,
} = require("../controllers/accountingControllers");

router.use(auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"));

router.get("/", checkPermission("accounting", "view"), listExpenses);
router.get("/:id", checkPermission("accounting", "view"), getExpense);
router.post("/", checkPermission("accounting", "create"), createExpense);
router.put("/:id", checkPermission("accounting", "edit"), updateExpense);
router.delete("/:id", checkPermission("accounting", "delete"), voidExpense);

module.exports = router;