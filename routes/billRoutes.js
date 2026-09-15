const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
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

// Admin / Accountant / Committee — create bill (gated by dynamic permission)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "create"), createBill);

// Admin / Accountant / Committee — view all society bills
router.get("/society", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("manage_bills", "view"), getSocietyBills);

// ✅ FAMILY_MEMBER and RESIDENT can view their flat's bills
router.get("/resident", auth, role("RESIDENT", "ACCOUNTANT", "FAMILY_MEMBER", "COMMITTEE_MEMBER"), attachFlatId, getResidentBills);

// Bulk confirm payment / approve
router.put("/bulk-confirm", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "edit"), bulkConfirmPayment);
router.post("/bulk-confirm", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "edit"), bulkConfirmPayment);

// Bulk delete
router.delete("/bulk", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "delete"), bulkDeleteBills);
router.post("/bulk-delete", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "delete"), bulkDeleteBills);

// Confirm single payment
router.put("/confirm/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "edit"), confirmPayment);

// Delete single bill
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER"), checkPermission("manage_bills", "delete"), deleteBill);

module.exports = router;