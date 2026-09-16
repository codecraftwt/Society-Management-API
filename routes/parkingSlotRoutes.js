

const express = require("express");
const router = express.Router();
const {
  createParkingSlots,
  getParkingSlots,
  getAvailableSlots,  
  updateParkingSlot,
  deleteParkingSlot,
  revokeSlotAssignment,
  getMyAllocatedSlots,
} = require("../controllers/parkingSlotControllers");

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");

/* ======
   GET AVAILABLE SLOTS (filtered by vehicle type) → GUARD
   🔥 MUST be above /:id to avoid "available" being treated as an id param
====== */
router.get(
  "/available",
  auth,
  role("GUARD", "SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  getAvailableSlots
);

/* ======
   REVOKE SLOT ASSIGNMENT
====== */
router.post(
  "/revoke",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("parking_slots", "release"),
  revokeSlotAssignment
);

/* ======
   CREATE SLOT → SOCIETY_ADMIN / COMMITTEE_MEMBER
====== */
router.post(
  "/",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("parking_slots", "create_slot"),
  createParkingSlots
);

/* ======
   VIEW SLOTS → GUARD + SOCIETY_ADMIN + COMMITTEE_MEMBER
====== */
router.get(
  "/",
  auth,
  role("GUARD", "SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("parking_slots", "view"),
  getParkingSlots
);

/* ======
   UPDATE SLOT
====== */
router.put(
  "/:id",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("parking_slots", "edit_slot"),
  updateParkingSlot
);

/* ======
   DELETE SLOT
====== */
router.delete(
  "/:id",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"),
  checkPermission("parking_slots", "delete_slot"),
  deleteParkingSlot
);

router.get("/my-slots", auth, getMyAllocatedSlots);

module.exports = router;