const Complaint = require("../models/Complaint");
const VisitorLog = require("../models/VisitorLog");
const Bill = require("../models/Bill");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const FlatMembership = require("../models/FlatMembership");
const Payment = require("../models/Payment");
const { getUserAuthorizedFlatIds } = require("../utils/accessHelpers");

/* === RESOLVE FLAT IDS ===
   Resolve the resident's flats, scoped to the ACTIVE society so reports never
   span their other societies. Falls back to all flats when no society is set. */
const getMyFlatIds = async (userId, societyId = null) => {
  const scoped =
    Number.isInteger(Number(societyId)) && Number(societyId) > 0
      ? Number(societyId)
      : null;
  return getUserAuthorizedFlatIds(userId, scoped);
};

/* === MY COMPLAINTS === */
const getMyComplaints = async (req, res) => {
  try {

    const activeSocietyId = parseInt(req.user?.society_id, 10);
    const complaints = await Complaint.findAll({
      where: {
        resident_id: req.user.id,
        ...(Number.isInteger(activeSocietyId) && activeSocietyId > 0
          ? { society_id: activeSocietyId }
          : {}),
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

    const myFlatIds = await getMyFlatIds(req.user.id, req.user?.society_id);
    if (myFlatIds.length === 0) return res.json([]);

    const visitors = await VisitorLog.findAll({
      where: { flat_id: myFlatIds },
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

    const myFlatIds = await getMyFlatIds(req.user.id, req.user.society_id);
    if (myFlatIds.length === 0) return res.json([]);

    const bills = await Bill.findAll({
      where: { flat_id: myFlatIds },
      include: {
        model: Payment,
        required: false,
        where: { status: "SUCCESS" },
        attributes: ["id", "amount", "payment_mode", "payment_date", "status"],
        order: [["payment_date", "DESC"]],
      },
      order: [["created_at", "DESC"]]
    });

    // Expose the most recent successful payment's date as paid_date.
    const result = bills.map((b) => {
      const bj = b.toJSON();
      const payments = bj.Payments || [];
      bj.paid_date = payments.length > 0 ? payments[0].payment_date : null;
      delete bj.Payments;
      return bj;
    });

    res.json(result);

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
