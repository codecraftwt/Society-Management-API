const Society = require("../models/Society");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const { Op } = require("sequelize");
const { Flat, User } = require("../models");

/* 
   GET ALL SOCIETIES (PUBLIC)
 */
exports.getSocieties = async (req, res) => {
  try {
    const societies = await Society.findAll({
      attributes: ["id", "name", "address"],
      order: [["name", "ASC"]],
    });

    res.json(societies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET BLOCKS / WINGS BY SOCIETY
 */
exports.getBlocks = async (req, res) => {
  try {
    const { societyId } = req.params;

    const blocks = await Block.findAll({
      where: { society_id: societyId },
      attributes: ["id", "name", "property_type"],
      order: [["name", "ASC"]],
    });

    res.json(blocks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET FLOORS BY BLOCK / WING (PUBLIC)
 */
exports.getFloors = async (req, res) => {
  try {
    const { blockId } = req.params;

    const floors = await Floor.findAll({
      where: { block_id: blockId },
      attributes: ["id", "floor_number", "block_id"],
      order: [["floor_number", "ASC"]],
    });

    res.json(floors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET UNASSIGNED FLATS (BY BLOCK AND OPTIONAL FLOOR)
 */
exports.getAvailableFlats = async (req, res) => {
  try {
    const { blockId } = req.params;
    const { floor_id } = req.query;

    const whereClause = {
      block_id: blockId,
      [Op.or]: [
        { resident_id: null },
        { "$User.status$": "INACTIVE" },
      ],
    };

    if (floor_id) {
      whereClause.floor_id = floor_id;
    }

    const flats = await Flat.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          attributes: ["id", "status"],
          required: false, // ⭐ allows null resident
        },
      ],
      attributes: ["id", "flat_number", "floor_id", "flat_type"],
      order: [["flat_number", "ASC"]],
    });

    res.json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* 
   GET UNASSIGNED FLATS BY FLOOR
 */
exports.getAvailableFlatsByFloor = async (req, res) => {
  try {
    const { floorId } = req.params;

    const flats = await Flat.findAll({
      where: {
        floor_id: floorId,
        [Op.or]: [
          { resident_id: null },
          { "$User.status$": "INACTIVE" },
        ],
      },
      include: [
        {
          model: User,
          attributes: ["id", "status"],
          required: false,
        },
      ],
      attributes: ["id", "flat_number", "floor_id", "block_id", "flat_type"],
      order: [["flat_number", "ASC"]],
    });

    res.json(flats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
