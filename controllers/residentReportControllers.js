const Complaint = require("../models/Complaint");
const VisitorLog = require("../models/VisitorLog");
const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Block = require("../models/Block");

/* === MY COMPLAINTS === */
const getMyComplaints = async (req, res) => {
  try {

    const complaints = await Complaint.findAll({
      where: {
        resident_id: req.user.id   // ✅ FIXED HERE
      },
      order: [["created_at", "DESC"]]
    });

    res.json(complaints);

  } catch (error) {
    console.error("getMyComplaints error:", error);
    res.status(500).json({ message: "Failed to fetch complaints" });
  }
};


/* === MY VISITORS === */
const getMyVisitors = async (req, res) => {
  try {

    // Find resident flat
    const flat = await Flat.findOne({
      where: { resident_id: req.user.id }
    });

    if (!flat) return res.json([]);

    const visitors = await VisitorLog.findAll({
      where: { flat_id: flat.id },
      include: [
        {
          model: Flat,
          attributes: ["flat_number"],
          include: {
            model: Block,
            attributes: ["name"]
          }
        }
      ],
      order: [["entry_time", "DESC"]]
    });

    res.json(visitors);

  } catch (error) {
    console.error("getMyVisitors error:", error);
    res.status(500).json({ message: "Failed to fetch visitors" });
  }
};

/* === MY BILLS === */
const getMyBills = async (req, res) => {
  try {

    const flat = await Flat.findOne({
      where: { resident_id: req.user.id }
    });

    if (!flat) return res.json([]);

    const bills = await Bill.findAll({
      where: { flat_id: flat.id },
      order: [["created_at", "DESC"]]
    });

    res.json(bills);

  } catch (error) {
    console.error("getMyBills error:", error);
    res.status(500).json({ message: "Failed to fetch bills" });
  }
};

module.exports = {
  getMyComplaints,
  getMyVisitors,
  getMyBills
};
