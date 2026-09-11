
const express = require("express");
const router  = express.Router();
const verifyToken = require("../middlewares/authMiddleware");


const {
  requestParking,
  lookupResidentVehicle,
  createResidentParking,
  getParkingRequests,
  assignParkingSlot,
  rejectParkingRequest,
  markExit,
  requestResidentSlot,
  adminAssignResidentSlot,
  getUnassignedResidentVehicles,
  adminRejectResidentSlot,
  adminCancelVehicleRequest
} = require("../controllers/parkingControllers");

const role = require("../middlewares/roleMiddleware");

router.use(verifyToken);

/* ── Resident / shared ── */
router.post("/",                         requestParking);
router.get("/",                          getParkingRequests);

/* ── Admin & Committee allocation ── */
router.get(
  "/unassigned-resident-vehicles",
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"),
  getUnassignedResidentVehicles
);
router.put(
  "/:id/admin-assign",
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"),
  adminAssignResidentSlot
);
router.put(
  "/:id/admin-reject",
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"),
  adminRejectResidentSlot
);
router.post(
  "/request-slot",
  requestResidentSlot
);

/* ── Guard: resident vehicle flow ── */
router.get("/lookup-vehicle",            lookupResidentVehicle);
router.post("/resident-entry",           createResidentParking);

/* ── Guard: visitor flow ── */
router.put("/:id/assign",               assignParkingSlot);
router.put("/:id/reject",               rejectParkingRequest);   // guard only
router.put("/:id/exit",                 markExit);


router.post(
  "/admin-cancel-vehicle-request",
  role("SOCIETY_ADMIN", "SUPER_ADMIN", "COMMITTEE_MEMBER"),
  adminCancelVehicleRequest
);
module.exports = router;