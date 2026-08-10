
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

/* ── Admin only ── */
router.get(
  "/unassigned-resident-vehicles",
  role("SOCIETY_ADMIN"),
  getUnassignedResidentVehicles
);
router.put(
  "/:id/admin-assign",
  role("SOCIETY_ADMIN"),
  adminAssignResidentSlot
);
router.put(
  "/:id/admin-reject",                   // ← separate admin reject (no shift check)
  role("SOCIETY_ADMIN"),
  adminRejectResidentSlot                // ← new controller function below
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
  role("SOCIETY_ADMIN"),
  adminCancelVehicleRequest
);
module.exports = router;