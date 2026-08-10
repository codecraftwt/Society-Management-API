const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {createBlock, getBlocksBySociety,deleteBlock,getSocietyName} = require("../controllers/blockControllers");

router.post("/", auth, role("SUPER_ADMIN","SOCIETY_ADMIN"), createBlock);
router.get("/:societyId", auth, role("SUPER_ADMIN","SOCIETY_ADMIN"), getBlocksBySociety);
router.delete("/:blockId", auth, role("SUPER_ADMIN","SOCIETY_ADMIN"), deleteBlock);
router.get("/getname/:societyId", auth, role("SUPER_ADMIN","SOCIETY_ADMIN"), getSocietyName);

module.exports = router;


