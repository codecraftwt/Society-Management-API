const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { createSociety, getAllSociety, getSocietyDetail, deleteSociety } = require("../controllers/societyControllers");



router.post("/", auth, role("SUPER_ADMIN"), createSociety);
router.get("/", auth, role("SUPER_ADMIN"), getAllSociety);
router.get("/:id/detail", auth, role("SUPER_ADMIN"), getSocietyDetail);
router.delete("/:id", auth, role("SUPER_ADMIN"), deleteSociety);


module.exports = router;