const router = require("express").Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  getNotifications,
  clearNotifications,
  markAsRead
} = require("../controllers/notificationControllers");

router.get("/", authMiddleware, getNotifications);
router.delete("/clear", authMiddleware, clearNotifications);
router.put("/:id/read", authMiddleware, markAsRead);

module.exports = router;
