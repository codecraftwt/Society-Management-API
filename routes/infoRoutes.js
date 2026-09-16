const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { getAllStat} = require("../controllers/infoControllers");

router.get("/stats", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "ACCOUNTANT"), getAllStat);

module.exports = router;