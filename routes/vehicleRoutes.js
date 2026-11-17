const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const enforceRulesAcknowledged = require("../middlewares/enforceRulesAcknowledged");

const {
  addVehicle,
  updateVehicle,
  getMyVehicles,
  deleteVehicle,
  // getSocietyVehicles,
  // verifyVehicle
} = require("../controllers/vehicleControllers");


// Resident
router.post("/", auth, role("RESIDENT", "FAMILY_MEMBER"), enforceRulesAcknowledged, addVehicle);
router.get("/my", auth, role("RESIDENT", "FAMILY_MEMBER"), getMyVehicles);
router.delete("/:id", auth, role("RESIDENT", "FAMILY_MEMBER"), deleteVehicle);
router.put("/:id", auth, role("RESIDENT", "FAMILY_MEMBER"), updateVehicle);


// // Guard / Admin
// router.get("/", auth, role("SOCIETY_ADMIN", "GUARD"), getSocietyVehicles);
// router.get("/verify/:vehicle_number", auth, role("GUARD"), verifyVehicle);

module.exports = router;
