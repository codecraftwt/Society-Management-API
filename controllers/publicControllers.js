const Society = require("../models/Society");
const Block = require("../models/Block");
const { Op } = require("sequelize");
const { Flat, User } = require("../models");

/* 
   GET ALL SOCIETIES (PUBLIC)
 */
exports.getSocieties = async (req, res) => {
  try {
    const societies = await Society.findAll({
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
    });

    res.json(societies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET BLOCKS BY SOCIETY
 */
exports.getBlocks = async (req, res) => {
  try {
    const { societyId } = req.params;

    const blocks = await Block.findAll({
      where: { society_id: societyId },
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
    });

    res.json(blocks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET UNASSIGNED FLATS
 */
exports.getAvailableFlats = async (req, res) => {
  try {
    const { blockId } = req.params;

    const flats = await Flat.findAll({
      where: {
        block_id: blockId,
        [Op.or]: [
          { resident_id: null },
          { "$User.status$": "INACTIVE" },
        ],
      },

      include: [
        {
          model: User,
          attributes: ["id", "status"],
          required: false, // ⭐ allows null resident
        },
      ],

      attributes: ["id", "flat_number"],
      order: [["flat_number", "ASC"]],
    });

    res.json(flats);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};