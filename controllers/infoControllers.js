const { Op } = require("sequelize");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const Block = require("../models/Block");
const Flat = require("../models/Flat");

const getAllStat = async (req, res) => {
  try {
    const societyId = (req.user.activeRole === "SUPER_ADMIN" && (req.headers["x-society-id"] || req.query.society_id))
      ? (req.headers["x-society-id"] || req.query.society_id)
      : req.user.society_id;

    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    // 1. Fetch all users in the society
    const allUsers = await User.findAll({
      where: { society_id: societyId },
      attributes: ["id", "email", "role", "roles"],
    });

    // 2. Count registered residents matching the resident management logic
    const residentUsers = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try { rList = JSON.parse(u.roles); } catch (e) { rList = []; }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }
      return rList.includes("RESIDENT");
    });

    const emailMap = new Map();
    residentUsers.forEach(user => {
      const key = user.email ? user.email.toLowerCase().trim() : user.id;
      if (!emailMap.has(key)) emailMap.set(key, true);
    });
    const residents = emailMap.size;

    // 3. Count guards
    const guards = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try { rList = JSON.parse(u.roles); } catch (e) { rList = []; }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }
      return rList.includes("GUARD");
    }).length;

    // 4. Count flats for all blocks in the society
    const blocks = await Block.findAll({
      where: { society_id: societyId },
      attributes: ["id"],
    });
    const blockIds = blocks.map(b => b.id);

    const allFlats = blockIds.length > 0 ? await Flat.findAll({
      where: { block_id: { [Op.in]: blockIds } },
      attributes: ["id", "occupancy_status", "resident_id"],
    }) : [];

    const totalFlats = allFlats.length;
    const occupiedFlats = allFlats.filter(f => f.occupancy_status === "RENTED" || f.occupancy_status === "OWNER_OCCUPIED" || f.resident_id !== null).length;
    const vacantFlats = totalFlats - occupiedFlats;

    // 5. Count open complaints
    const openComplaints = await Complaint.count({
      where: {
        society_id: societyId,
        status: { [Op.in]: ["OPEN", "PENDING", "IN_PROGRESS"] },
      },
    });

    res.json({
      residents,
      guards,
      openComplaints,
      totalFlats,
      occupiedFlats,
      vacantFlats,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
};

module.exports = { getAllStat };