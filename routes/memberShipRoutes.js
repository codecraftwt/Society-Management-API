/**
 * routes/membership.js
 *
 * Add this file and require it in your main app.js / server.js:
 *
 *   const membershipRoutes = require("./routes/membership");
 *   app.use("/", membershipRoutes);
 *
 * This file adds the NEW routes for FlatMembership and MaintenanceRate.
 * Your existing flat/user routes need two small updates (see bottom of file).
 */

const express = require("express");
const router = express.Router();

// Middleware
const verifyToken = require("../middlewares/authMiddleware"); // adjust path as needed

// Controllers
const {
  createMembership,
  getMembershipsForFlat,
  getMembershipsForUser,
  endMembership,
  updateMembership,
} = require("../controllers/flatMembershipController");

const {
  getRates,
  upsertRate,
  upsertRates,
} = require("../controllers/maintenanceRateController");

// Updated flat + user controller functions
const {
  getUnassignedFlats,
  getAssignedFlats,
  assignResident,
  unassignResident,
} = require("../controllers/flatControllers");

const {
  createResident,
  getResidents,
  deleteResident,
  // getMyUnits,
  getMyFlat,
  getUnassignedResidents,
} = require("../controllers/userControllers");

/* ══════════════════════════════════════════
   FLAT MEMBERSHIP ROUTES
══════════════════════════════════════════ */

// Create a membership for a flat
router.post(
  "/flats/:flatId/memberships",
  verifyToken,
  createMembership
);

// Get all memberships for a flat (?all=1 for history)
router.get(
  "/flats/:flatId/memberships",
  verifyToken,
  getMembershipsForFlat
);

// Get all memberships (flats) for a user (?all=1 for history)
router.get(
  "/users/:userId/memberships",
  verifyToken,
  getMembershipsForUser
);

// End a membership (soft delete)
router.delete(
  "/memberships/:id",
  verifyToken,
  endMembership
);

// Update is_staying / pays_maintenance / role
router.patch(
  "/memberships/:id",
  verifyToken,
  updateMembership
);

/* ══════════════════════════════════════════
   MAINTENANCE RATE ROUTES
══════════════════════════════════════════ */

// Get all rates for the society
router.get("/rates", verifyToken, getRates);

// Create or update a single rate
router.post("/rates", verifyToken, upsertRate);

// Batch save from RateCard UI
router.post("/rates/batch", verifyToken, upsertRates);

/* ══════════════════════════════════════════
   UPDATED FLAT ROUTES
   Replace existing /flats/unassigned, /flats/assigned,
   /flats/assign/:flatId, /flats/unassign/:flatId
   with these membership-aware versions.
══════════════════════════════════════════ */

// Flats with no active is_staying member (for dropdowns)
router.get("/flats/unassigned", verifyToken, getUnassignedFlats);

// Flats with at least one active membership (for assignment table)
router.get("/flats/assigned", verifyToken, getAssignedFlats);

// Assign a resident by creating a FlatMembership
router.put("/flats/assign/:flatId", verifyToken, assignResident);

// End all active memberships on a flat
router.put("/flats/unassign/:flatId", verifyToken, unassignResident);

/* ══════════════════════════════════════════
   UPDATED USER / RESIDENT ROUTES
══════════════════════════════════════════ */

// Create resident (with optional flat assignment)
router.post("/users/resident", verifyToken, createResident);

// List residents with membership arrays
router.get("/users/resident", verifyToken, getResidents);

// Delete resident (closes memberships)
router.delete("/users/resident/:id", verifyToken, deleteResident);

// Get unassigned residents (zero active memberships)
router.get("/users/resident/unassigned", verifyToken, getUnassignedResidents);

// Get all units for the logged-in resident
router.get("/users/me/units", verifyToken, getMyFlat);

module.exports = router;