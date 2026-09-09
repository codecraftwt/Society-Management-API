const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  createGuard,
  getGuards,
  updateGuard,
  deleteGuard,
} = require("../controllers/userControllers");

router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createGuard);
router.get("/all", auth, role("SUPER_ADMIN"), getGuards);
router.get("/society/:societyId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getGuards);
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getGuards);
router.put("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateGuard);
router.delete("/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteGuard);

module.exports = router;
