const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
const {
  createGuard,
  getGuards,
  updateGuard,
  deleteGuard,
} = require("../controllers/userControllers");
const {
  upsertShift,
  updateShift,
  deleteShift,
  getGuardShiftByGuard,
} = require("../controllers/guardShiftControllers");

router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "create"), createGuard);
router.get("/all", auth, role("SUPER_ADMIN"), getGuards);
router.get("/society/:societyId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "view"), getGuards);
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "view"), getGuards);

// ── Guard shift sub-routes (matching Web UI: /guards/:id/shifts) ──
router.post("/:id/shifts", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "edit_shift"), (req, res) => {
  req.body.guard_id = req.params.id;
  upsertShift(req, res);
});
router.get("/:id/shifts", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "view"), (req, res) => {
  req.params.guardId = req.params.id;
  getGuardShiftByGuard(req, res);
});
router.put("/shifts/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "edit_shift"), updateShift);
router.delete("/shifts/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "edit_shift"), deleteShift);

router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "edit"), updateGuard);
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), checkPermission("guard", "delete"), deleteGuard);

module.exports = router;

