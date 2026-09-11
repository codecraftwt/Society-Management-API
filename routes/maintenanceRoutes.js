const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const maintenanceController = require("../controllers/maintenanceControllers");

const VIEW_ROLES = ["SOCIETY_ADMIN", "COMMITTEE_MEMBER"];
const WRITE_ROLES = ["SOCIETY_ADMIN"];

// Configuration management (write = admin only)
router.get("/config", auth, role(...VIEW_ROLES), maintenanceController.getConfigs);
router.post("/config", auth, role(...WRITE_ROLES), maintenanceController.saveConfig);
router.delete("/config/:id", auth, role(...WRITE_ROLES), maintenanceController.deleteConfig);

// Available flat types in this society (for config validation / dropdown)
router.get("/flat-types", auth, role(...VIEW_ROLES), maintenanceController.listFlatTypes);

// Bill preview & generation (generate = admin only; committee view/preview)
router.get("/preview", auth, role(...VIEW_ROLES), maintenanceController.previewBills);
router.post("/preview", auth, role(...VIEW_ROLES), maintenanceController.previewBills);
router.post("/generate", auth, role(...WRITE_ROLES), maintenanceController.generateBills);

// Generated bill viewing
router.get("/bills", auth, role(...VIEW_ROLES), maintenanceController.listBills);
router.get("/bills/:id", auth, role(...VIEW_ROLES), maintenanceController.getBillDetail);

module.exports = router;
