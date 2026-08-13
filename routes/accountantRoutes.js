const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  getSocietyBills,
  getPayments,
  monthlyCollection,
} = require("../controllers/accountantControllers");

router.get("/bills", auth, role("ACCOUNTANT"), getSocietyBills);
router.get("/payments", auth, role("ACCOUNTANT"), getPayments);
router.get("/payments/summary", auth, role("ACCOUNTANT"), monthlyCollection);

module.exports = router;
