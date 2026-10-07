const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  createSociety,
  getAllSociety,
  getSocietyDetail,
  deleteSociety,
  getSocietyTheme,
  updateSocietyTheme,
  resetSocietyTheme,
  getSocietyGeofence,
  updateSocietyGeofence,
} = require("../controllers/societyControllers");

router.post("/", auth, role("SUPER_ADMIN"), createSociety);
router.get("/", auth, role("SUPER_ADMIN"), getAllSociety);
router.get("/:id/detail", auth, role("SUPER_ADMIN"), getSocietyDetail);
router.delete("/:id", auth, role("SUPER_ADMIN"), deleteSociety);

// Theme customization routes
router.get("/:id/theme", auth, getSocietyTheme);
router.put("/:id/theme", auth, updateSocietyTheme);
router.post("/:id/theme/reset", auth, resetSocietyTheme);

// Geofence configuration routes (scoped to caller's society)
router.get("/geofence", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getSocietyGeofence);
router.put("/geofence", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateSocietyGeofence);

module.exports = router;