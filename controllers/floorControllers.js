

const Floor = require("../models/Floor");

/* === GET FLOORS BY BLOCK === */
const getFloorsByBlock = async (req, res) => {
  try {
    const { blockId } = req.params;

    const floors = await Floor.findAll({
      where: { block_id: blockId },
      order: [["floor_number", "ASC"]],
    });

    res.status(200).json(floors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getFloorsByBlock };