const express = require("express");
const router = express.Router();
const { getFloorsByBlock } = require("../controllers/floorControllers");
const auth = require("../middlewares/authMiddleware"); // Protect route

// Route: GET /api/floors/:blockId
router.get("/:blockId", auth, getFloorsByBlock);

module.exports = router;