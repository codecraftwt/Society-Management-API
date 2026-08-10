const { GuardLog, User } = require("../models");

// 1. Create a new Log Entry
const addLog = async (req, res) => {
  try {
    const { text, is_important } = req.body;

    if (!text) {
      return res.status(400).json({ message: "Log text is required" });
    }

    const newLog = await GuardLog.create({
      text,
      is_important: is_important || false,
      guard_id: req.user.id,        // From Auth Middleware
      society_id: req.user.society_id // From Auth Middleware
    });

    // Fetch the log again to include author details immediately for the UI
    const logWithAuthor = await GuardLog.findOne({
      where: { id: newLog.id },
      include: [
        { 
          model: User, 
          as: "author", 
          attributes: ["id", "name", "phone"] // Only send necessary info
        }
      ]
    });

    res.status(201).json(logWithAuthor);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

// 2. Get All Logs for the Society (Paginated or Limit 50)
const getLogs = async (req, res) => {
  try {
    const logs = await GuardLog.findAll({
      where: { society_id: req.user.society_id },
      include: [
        { 
          model: User, 
          as: "author", 
          attributes: ["id", "name", "role"] 
        }
      ],
      order: [["createdAt", "DESC"]], // Newest first
      limit: 50 // Performance optimization: Only load last 50 logs
    });

    res.json(logs);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error fetching logs" });
  }
};

// 3. Delete a Log (Manual Delete)
const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const log = await GuardLog.findByPk(id);

    if (!log) {
      return res.status(404).json({ message: "Log entry not found" });
    }

    // SECURITY CHECK:
    // Allow delete only if:
    // 1. User is the Creator of the log OR
    // 2. User is an ADMIN
    if (log.guard_id !== req.user.id && req.user.role !== "ADMIN" && req.user.role !== "SOCIETY_ADMIN") {
      return res.status(403).json({ message: "Not authorized to delete this log" });
    }

    await log.destroy();
    res.json({ message: "Log entry deleted successfully", id: parseInt(id) });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error deleting log" });
  }
};

module.exports = {
  addLog,
  getLogs,
  deleteLog
};