const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const attachFlatId = require("../middlewares/flatAccessMiddleware");
const { createBill, getSocietyBills, getResidentBills, deleteBill } = require("../controllers/billControllers");

// Admin / Accountant — create
router.post("/", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), createBill);

// Admin / Accountant — view all society bills
router.get("/society", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getSocietyBills);

// ✅ FAMILY_MEMBER can view their flat's bills (read only)
router.get("/resident", auth, role("RESIDENT", "ACCOUNTANT", "FAMILY_MEMBER"), attachFlatId, getResidentBills);

// Admin / Accountant — delete
router.delete("/:id", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), deleteBill);

module.exports = router;