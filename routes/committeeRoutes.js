const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { getDashboardStats } = require("../controllers/committeeControllers");

router.get("/dashboard-stats", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getDashboardStats);

module.exports = router;
