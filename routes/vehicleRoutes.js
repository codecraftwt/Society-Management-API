const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  addVehicle,
  getMyVehicles,
  deleteVehicle,
  // getSocietyVehicles,
  // verifyVehicle
} = require("../controllers/vehicleControllers");


// Resident
router.post("/", auth, role("RESIDENT"), addVehicle);
router.get("/my", auth, role("RESIDENT"), getMyVehicles);
router.delete("/:id", auth, role("RESIDENT"), deleteVehicle);


// // Guard / Admin
// router.get("/", auth, role("SOCIETY_ADMIN", "GUARD"), getSocietyVehicles);
// router.get("/verify/:vehicle_number", auth, role("GUARD"), verifyVehicle);

module.exports = router;
