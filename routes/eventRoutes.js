const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { checkPermission } = require("../middlewares/permissionMiddleware");
const uploadEventMedia = require("../middlewares/uploadEventMedia");
const {
  getResidentEvents,
  getAdminEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
} = require("../controllers/eventControllers");

// Resident / Public event list
router.get("/", authMiddleware, getResidentEvents);

// Admin event list
router.get("/admin", authMiddleware, checkPermission("events", "view"), getAdminEvents);

// Event detail
router.get("/:id", authMiddleware, checkPermission("events", "view"), getEventById);

// Create event
router.post("/", authMiddleware, checkPermission("events", "create"), uploadEventMedia, createEvent);

// Update event
router.put("/:id", authMiddleware, checkPermission("events", "edit"), uploadEventMedia, updateEvent);

// Delete event
router.delete("/:id", authMiddleware, checkPermission("events", "delete"), deleteEvent);

module.exports = router;
