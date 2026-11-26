const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/expenseCategoryControllers");

const financeRoles = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"];

router.use(auth, role(...financeRoles));

router.get("/", checkPermission("expenses", "view"), listCategories);
router.post("/", checkPermission("expenses", "create"), createCategory);
router.put("/:id", checkPermission("expenses", "edit"), updateCategory);
router.delete("/:id", checkPermission("expenses", "delete"), deleteCategory);

module.exports = router;
