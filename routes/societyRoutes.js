const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const uploadSocietyLogo = require("../middlewares/uploadSocietyLogo");
const handleSocietyLogoUploadErrors = require("../middlewares/societyLogoUploadErrors");
const {
  createSociety,
  getAllSociety,
  getSocietyDetail,
  deleteSociety,
  getSocietyTheme,
  updateSocietyTheme,
  resetSocietyTheme,
  uploadSocietyLogo: uploadSocietyLogoHandler,
  removeSocietyLogo: removeSocietyLogoHandler,
  getSocietyGeofence,
  updateSocietyGeofence,
} = require("../controllers/societyControllers");

router.post("/", auth, role("SUPER_ADMIN"), createSociety);
router.get("/", auth, role("SUPER_ADMIN"), getAllSociety);
router.get("/:id/detail", auth, role("SUPER_ADMIN"), getSocietyDetail);
router.delete("/:id", auth, role("SUPER_ADMIN"), deleteSociety);

// Theme & Branding customization routes
router.get("/:id/theme", auth, getSocietyTheme);
router.put("/:id/theme", auth, updateSocietyTheme);
router.post("/:id/theme/reset", auth, resetSocietyTheme);

// Society Logo routes (authorized for Super Admin and respective Society Admin)
router.post(
  "/:id/logo",
  auth,
  uploadSocietyLogo.single("logo"),
  handleSocietyLogoUploadErrors,
  uploadSocietyLogoHandler
);
router.delete("/:id/logo", auth, removeSocietyLogoHandler);

// Geofence configuration routes (scoped to caller's society)
router.get("/geofence", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getSocietyGeofence);
router.put("/geofence", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateSocietyGeofence);

module.exports = router;