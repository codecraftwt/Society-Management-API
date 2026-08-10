const express = require("express");
const router = express.Router();

const {
  moveInResident,
  moveOutResident,
  getFlatHistory,
} = require("../controllers/flatHistoryController");

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

// ✅ Specific routes BEFORE dynamic param route
router.post("/move-in", auth, role("SOCIETY_ADMIN"), moveInResident);
router.post("/move-out", auth, role("SOCIETY_ADMIN"), moveOutResident);
router.get("/:flat_id", auth, role("SOCIETY_ADMIN"), getFlatHistory);

module.exports = router;