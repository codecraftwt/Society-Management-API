const express = require("express");
const router = express.Router();
const { addLog, getLogs, deleteLog } = require("../controllers/guardLogControllers");
const verifyToken = require("../middlewares/authMiddleware");

// Apply Auth Middleware to all routes
router.use(verifyToken);

// Routes
router.post("/", addLog);         // Add new log
router.get("/", getLogs);         // Get all logs
router.delete("/:id", deleteLog); // Delete specific log

module.exports = router;