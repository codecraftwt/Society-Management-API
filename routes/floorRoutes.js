const express = require("express");
const router = express.Router();
const { getFloorsByBlock, getFloorDetail } = require("../controllers/floorControllers");
const auth = require("../middlewares/authMiddleware"); // Protect route

// Route: GET /api/floors/:blockId (floors by block)
router.get("/:blockId", auth, getFloorsByBlock);
// Route: GET /api/floors/detail/:floorId (single floor detail)
router.get("/detail/:floorId", auth, getFloorDetail);

module.exports = router;