

const express = require("express");
const router = express.Router();
const {
  createParkingSlots,
  getParkingSlots,
  getAvailableSlots,  
  deleteParkingSlot,
  revokeSlotAssignment,
  getMyAllocatedSlots,
} = require("../controllers/parkingSlotControllers");

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

/* ======
   GET AVAILABLE SLOTS (filtered by vehicle type) → GUARD
   🔥 MUST be above /:id to avoid "available" being treated as an id param
====== */
router.get(
  "/available",
  auth,
  role("GUARD", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  getAvailableSlots
);



/* ======
   REVOKE SLOT ASSIGNMENT
====== */
router.post(
  "/revoke",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN"),
  revokeSlotAssignment
);

/* ======

/* ======
   CREATE SLOT → SOCIETY_ADMIN ONLY
====== */
router.post(
  "/",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN"),
  createParkingSlots
);

/* ======
   VIEW SLOTS → GUARD + SOCIETY_ADMIN
====== */
router.get(
  "/",
  auth,
  role("GUARD", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  getParkingSlots
);

/* ======
   DELETE SLOT → SOCIETY_ADMIN
====== */
router.delete(
  "/:id",
  auth,
  role("SOCIETY_ADMIN", "SUPER_ADMIN"),
  deleteParkingSlot
);

router.get("/my-slots", auth, getMyAllocatedSlots);

module.exports = router;