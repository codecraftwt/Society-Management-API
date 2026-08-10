const Society = require("../models/Society");
const User = require("../models/User");
const { Block, Flat, VisitorLog, Payment, Complaint, Notice, Bill ,Notification} =
  require("../models");

// CREATE SOCIETY
const createSociety = async (req, res) => {
  try {
    const society = await Society.create(req.body);
    res.status(200).json(society);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET ALL SOCIETIES WITH ADMINS
const getAllSociety = async (req, res) => {
  try {
    const societies = await Society.findAll({
      include: [
        {
          model: User,
          where: { role: "SOCIETY_ADMIN" },
          required: false,
          attributes: ["id", "name", "email"],
        },
      ],
    });

    const formatted = societies.map(s => ({
      id: s.id,
      name: s.name,
      address: s.address,
      societyAdmins:
        s.Users.length > 0
          ? {
              id: s.Users[0].id,
              name: s.Users[0].name,
              email: s.Users[0].email,
            }
          : null,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteSociety = async (req, res) => {
    const { id } = req.params;

    try {
        const society = await Society.findByPk(id);
        if (!society) {
            return res.status(400).json({ message: "Society is not found." });
        }

        // Get all users first (needed for notifications)
        const users = await User.findAll({ where: { society_id: id } });
        const userIds = users.map(u => u.id);

        const blocks = await Block.findAll({ where: { society_id: id } });
        const blockIds = blocks.map(b => b.id);

        const flats = await Flat.findAll({ where: { block_id: blockIds } });
        const flatIds = flats.map(f => f.id);

        const bills = await Bill.findAll({ where: { flat_id: flatIds } });
        const billIds = bills.map(b => b.id);

        // Delete in correct order (child → parent)
        await Payment.destroy({ where: { bill_id: billIds } });
        await Bill.destroy({ where: { flat_id: flatIds } });

        await VisitorLog.destroy({ where: { flat_id: flatIds } });

        await Flat.destroy({ where: { block_id: blockIds } });
        await Block.destroy({ where: { society_id: id } });

        await Complaint.destroy({ where: { society_id: id } });
        await Notice.destroy({ where: { society_id: id } });

        // 🔥 FIX HERE
        await Notification.destroy({ where: { user_id: userIds } });

        await User.destroy({ where: { society_id: id } });

        await Society.destroy({ where: { id } });

        res.status(200).json({ message: "Society Deleted Successfully !!" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { createSociety, getAllSociety, deleteSociety };