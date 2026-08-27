

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


/* === GET FLOOR DETAIL === */
const getFloorDetail = async (req, res) => {
  try {
    const { floorId } = req.params;
    const floor = await Floor.findByPk(floorId);
    if (!floor) return res.status(404).json({ message: 'Floor not found' });
    res.status(200).json(floor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getFloorsByBlock, getFloorDetail };