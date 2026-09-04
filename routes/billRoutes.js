const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const attachFlatId = require("../middlewares/flatAccessMiddleware");
const {
  createBill,
  getSocietyBills,
  getResidentBills,
  confirmPayment,
  deleteBill,
  bulkConfirmPayment,
  bulkDeleteBills,
} = require("../controllers/billControllers");

// Admin / Accountant — create
router.post("/", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), createBill);

// Admin / Accountant — view all society bills
router.get("/society", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getSocietyBills);

// ✅ FAMILY_MEMBER can view their flat's bills (read only)
router.get("/resident", auth, role("RESIDENT", "ACCOUNTANT", "FAMILY_MEMBER"), attachFlatId, getResidentBills);

// Admin / Accountant — bulk confirm payment / approve
router.put("/bulk-confirm", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), bulkConfirmPayment);
router.post("/bulk-confirm", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), bulkConfirmPayment);

// Admin / Accountant — bulk delete
router.delete("/bulk", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), bulkDeleteBills);
router.post("/bulk-delete", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), bulkDeleteBills);

// Admin / Accountant — confirm payment
router.put("/confirm/:id", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), confirmPayment);

// Admin / Accountant — delete
router.delete("/:id", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), deleteBill);

module.exports = router;