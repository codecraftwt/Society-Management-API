const { Op } = require("sequelize");
const { User, Notice, Complaint, Bill, Payment, VisitorLog } = require("../models");

const getDashboardStats = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const [
      totalResidents,
      activeNotices,
      pendingComplaints,
      resolvedComplaints,
      overdueBills,
      paidBills,
      todayVisitors,
      payments,
    ] = await Promise.all([
      User.count({
        where: {
          society_id: societyId,
          role: "RESIDENT",
        },
      }),
      Notice.count({
        where: { society_id: societyId },
      }),
      Complaint.count({
        where: {
          society_id: societyId,
          status: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        },
      }),
      Complaint.count({
        where: {
          society_id: societyId,
          status: "RESOLVED",
        },
      }),
      Bill.count({
        include: [
          {
            model: require("../models/Flat"),
            required: true,
            include: [
              {
                model: require("../models/Block"),
                required: true,
                where: { society_id: societyId },
              },
            ],
          },
        ],
        where: {
          status: "PENDING",
          due_date: { [Op.lt]: new Date() },
        },
      }),
      Bill.count({
        include: [
          {
            model: require("../models/Flat"),
            required: true,
            include: [
              {
                model: require("../models/Block"),
                required: true,
                where: { society_id: societyId },
              },
            ],
          },
        ],
        where: {
          status: "PAID",
        },
      }),
      VisitorLog.count({
        where: {
          society_id: societyId,
          entry_time: { [Op.between]: [startOfDay, endOfDay] },
        },
      }),
      Payment.findAll({
        attributes: ["amount"],
        include: [
          {
            model: Bill,
            required: true,
            attributes: [],
            include: [
              {
                model: require("../models/Flat"),
                required: true,
                attributes: [],
                include: [
                  {
                    model: require("../models/Block"),
                    required: true,
                    attributes: [],
                    where: { society_id: societyId },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    const totalRevenue = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return res.json({
      totalResidents,
      activeNotices,
      pendingComplaints,
      overduePayments: overdueBills,
      totalVisitors: todayVisitors,
      resolvedComplaints,
      totalRevenue,
      pendingBills: overdueBills,
      paidBills,
    });
  } catch (error) {
    console.error("Committee dashboard error:", error);
    return res.status(500).json({ message: "Committee dashboard fetch failed" });
  }
};

module.exports = {
  getDashboardStats,
};
