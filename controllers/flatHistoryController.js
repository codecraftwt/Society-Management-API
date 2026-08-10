
const { Flat, User } = require("../models");
const ResidentHistory = require("../models/ResidentHistory");


// 🟢 MOVE-IN (assign new resident)
const moveInResident = async (req, res) => {
  try {
    const { flat_id, user_id } = req.body;

    // 1. Close previous resident (if exists)
    await ResidentHistory.update(
      {
        move_out_date: new Date(),
        is_current: false,
      },
      {
        where: {
          flat_id,
          is_current: true,
        },
      }
    );

    // 2. Add new resident history
    const history = await ResidentHistory.create({
      flat_id,
      user_id,
      move_in_date: new Date(),
      is_current: true,
    });

    // 3. Update Flat current resident
    await Flat.update(
      { resident_id: user_id },
      { where: { id: flat_id } }
    );

    res.status(201).json({
      message: "Resident moved in successfully",
      history,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// 🔴 MOVE-OUT (remove resident)
const moveOutResident = async (req, res) => {
  try {
    const { flat_id, user_id } = req.body;

    // 1. Update history
    await ResidentHistory.update(
      {
        move_out_date: new Date(),
        is_current: false,
      },
      {
        where: {
          flat_id,
          user_id,
          is_current: true,
        },
      }
    );

    // 2. Remove current resident from flat
    await Flat.update(
      { resident_id: null },
      { where: { id: flat_id } }
    );

    res.json({
      message: "Resident moved out successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// 📜 GET FULL FLAT HISTORY
const getFlatHistory = async (req, res) => {
  try {
    const { flat_id } = req.params;

    const history = await ResidentHistory.findAll({
      where: { flat_id },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "approval_status"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const filteredHistory = history.filter(h => h.User?.approval_status !== "REJECTED");

    res.json(filteredHistory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  moveInResident,
  moveOutResident,
  getFlatHistory,
};