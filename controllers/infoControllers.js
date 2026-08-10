const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { Sequelize } = require("sequelize");
const Block = require("../models/Block");
const Floor = require("../models/Floor"); // ✅ ADD THIS
const Flat = require("../models/Flat");

const getAllStat = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    // ✅ FIX: Flat → Floor → Block (not Flat → Block directly)
    const allFlats = await Flat.findAll({
      attributes: ["id", "resident_id"],
      include: [
        {
          model: Floor,
          attributes: [],
          required: true,
          include: [
            {
              model: Block,
              attributes: [],
              where: { society_id: societyId },
              required: true,
            },
          ],
        },
      ],
    });

    const totalFlats    = allFlats.length;
    const occupiedFlats = allFlats.filter(f => f.resident_id !== null).length;
    const vacantFlats   = totalFlats - occupiedFlats;
    const residents     = occupiedFlats; // residents = occupied flats count

    const guards = await User.count({
      where: {
        society_id: societyId,
        role: "GUARD",
      },
    });

    const openComplaints = await Complaint.count({
      where: {
        society_id: societyId,
        status: ["OPEN", "PENDING"],
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