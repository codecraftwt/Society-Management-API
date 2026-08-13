const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { getDashboardStats } = require("../controllers/committeeControllers");

router.get("/dashboard-stats", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getDashboardStats);

module.exports = router;
