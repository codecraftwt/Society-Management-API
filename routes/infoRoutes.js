const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { getAllStat} = require("../controllers/infoControllers");

router.get("/stats", auth, role("SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getAllStat);

module.exports = router;