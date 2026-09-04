const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const maintenanceController = require("../controllers/maintenanceControllers");

const MAINTENANCE_ROLES = ["SOCIETY_ADMIN", "COMMITTEE_MEMBER"];

// Configuration management
router.get("/config", auth, role(...MAINTENANCE_ROLES), maintenanceController.getConfigs);
router.post("/config", auth, role(...MAINTENANCE_ROLES), maintenanceController.saveConfig);
router.delete("/config/:id", auth, role(...MAINTENANCE_ROLES), maintenanceController.deleteConfig);

// Available flat types in this society (for config validation / dropdown)
router.get("/flat-types", auth, role(...MAINTENANCE_ROLES), maintenanceController.listFlatTypes);

// Bill generation
router.post("/generate", auth, role(...MAINTENANCE_ROLES), maintenanceController.generateBills);

// Generated bill viewing
router.get("/bills", auth, role(...MAINTENANCE_ROLES), maintenanceController.listBills);
router.get("/bills/:id", auth, role(...MAINTENANCE_ROLES), maintenanceController.getBillDetail);

module.exports = router;
