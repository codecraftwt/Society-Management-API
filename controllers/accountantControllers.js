const { Op } = require("sequelize");
const { Bill, Flat, User, Block, Payment, Society } = require("../models");

const getSocietyBills = async(req,res)=>{
   try{
     const bills = await Bill.findAll({
        include : {
            model : Flat,
            required : true,
            attributes : ["id", "flat_number"],
            include : [
                {
                  model : Block,
                  required : true,
                  attributes : ["id", "name"],
                  where : { society_id : req.user.society_id}
                }, 
                {
                  model : User,
                  attributes : ["id", "name"]
                },
              
            ]
        },
        order : [["created_at", "DESC"]]
     });

     res.status(200).json(bills);
   }
   catch(err){
     res.status(500).json({message : err.message});
   }
};

const getPayments = async(req,res)=>{
   try{
     const payments = await Payment.findAll({
        include : {
            model : Bill,
            required : true,
            include : {
                model : Flat,
                required : true,
                include : [
                  {
                    model : Block,
                    required : true,
                    attributes : ["id","name"],
                    where : {society_id : req.user.society_id}
                  },
                  {
                    model : User,
                    attributes : ["name"]
                  }
              ]
                
            }
        },
        order : [["payment_date", "DESC"]]
     });

     res.status(200).json(payments);
   }
   catch(err){
     res.status(500).json({message : err.message});
   }
}

const monthlyCollection = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    // Start of current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // End of current month
    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const result = await Payment.findAll({
      attributes: [
        "payment_mode",
        [Payment.sequelize.fn("SUM", Payment.sequelize.col("Payment.amount")), "total"],
        [Payment.sequelize.fn("COUNT", Payment.sequelize.col("Payment.id")), "transactions"],
        [Payment.sequelize.fn("AVG", Payment.sequelize.col("Payment.amount")), "average"],
        [Payment.sequelize.fn("MAX", Payment.sequelize.col("Payment.payment_date")), "last_payment"]
      ],
      where: {
        payment_date: {
          [Op.between]: [startOfMonth, endOfMonth]
        }
      },
      include: {
        model: Bill,
        required: true,
        attributes: [],
        include: {
          model: Flat,
          required: true,
          attributes: [],
          include: {
            model: Block,
            required: true,
            attributes: [],
            where: { society_id: societyId }
          }
        }
      },
      group: ["payment_mode"]
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) {
      return res.status(400).json({ message: "Society ID missing in token" });
    }

    const society = await Society.findByPk(societyId);
    const societyName = society ? society.name : null;

    const now = new Date();
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(now);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const billInclude = {
      model: Flat,
      required: true,
      attributes: [],
      include: {
        model: Block,
        required: true,
        attributes: [],
        where: { society_id: societyId },
      },
    };

    const [bills, payments, monthlyPayments] = await Promise.all([
      Bill.findAll({
        attributes: ["id", "status", "amount"],
        include: billInclude,
      }),
      Payment.findAll({
        attributes: ["amount"],
        include: {
          model: Bill,
          required: true,
          attributes: [],
          include: {
            model: Flat,
            required: true,
            attributes: [],
            include: {
              model: Block,
              required: true,
              attributes: [],
              where: { society_id: societyId },
            },
          },
        },
      }),
      Payment.findAll({
        attributes: ["amount"],
        where: {
          payment_date: { [Op.between]: [startOfMonth, endOfMonth] },
        },
        include: {
          model: Bill,
          required: true,
          attributes: [],
          include: {
            model: Flat,
            required: true,
            attributes: [],
            include: {
              model: Block,
              required: true,
              attributes: [],
              where: { society_id: societyId },
            },
          },
        },
      }),
    ]);

    const totalBills        = bills.length;
    const paidBills         = bills.filter(b => b.status === "PAID");
    const pendingBills      = bills.filter(b => b.status !== "PAID");
    const awaitingConfirm   = bills.filter(b => b.status === "PENDING_VERIFICATION");
    const totalCollected    = paidBills.reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalDue          = pendingBills.reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalCollectedAll = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const monthlyCollected  = monthlyPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidRate          = totalBills ? Math.round((paidBills.length / totalBills) * 100) : 0;

    return res.json({
      societyName: societyName || req.user.society_name || null,
      totalBills,
      paidBills: paidBills.length,
      pendingBills: pendingBills.length,
      awaitingConfirm: awaitingConfirm.length,
      totalCollected,
      totalDue,
      totalCollectedAll,
      monthlyCollected,
      monthlyTransactions: monthlyPayments.length,
      paidRate,
    });
  } catch (err) {
    console.error("Accountant dashboard stats error:", err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getSocietyBills, getPayments, monthlyCollection, getDashboardStats };