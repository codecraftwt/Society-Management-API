const { Op } = require("sequelize");
const { Bill, Flat, User, Block, Payment } = require("../models");

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

module.exports = {getSocietyBills, getPayments, monthlyCollection};