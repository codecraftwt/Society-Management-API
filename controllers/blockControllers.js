const Block = require("../models/Block");
const Floor = require("../models/Floor");
const Flat = require("../models/Flat");
const Society = require("../models/Society");
const FlatMembership = require("../models/FlatMembership");
const ParkingSlot = require("../models/ParkingSlot");
const Vehicle = require("../models/Vehicle");
const HouseHoldMember = require("../models/HouseHoldMember");

const { Op } = require("sequelize");

const TYPE_MAP = { "Apartments": "APARTMENT", "Row Houses": "ROW_HOUSE", "Commercial": "COMMERCIAL" };

const createBlock = async (req, res) => {
  try {
    const {
      name,
      society_id,
      floor_count,
      flats_per_floor,
      property_type,
      area_sqft,
    } = req.body;

    const type = TYPE_MAP[property_type] || property_type || "APARTMENT";

    // ✅ VALIDATION
    if (type === "ROW_HOUSE" && floor_count) {
      return res.status(400).json({
        message: "Row House should not have floor_count",
      });
    }

    // ✅ CREATE BLOCK FIRST
    const block = await Block.create({
      name,
      society_id,
      property_type: type,
    });

    // ✅ APARTMENT / COMMERCIAL
    if (type === "APARTMENT" || type === "COMMERCIAL") {
      const floorCount = parseInt(floor_count);
      const flatsPerFloor = parseInt(flats_per_floor);

      for (let i = 1; i <= floorCount; i++) {
        const floor = await Floor.create({
          floor_number: `${i}`,
          block_id: block.id,
        });

        const flats = [];
        for (let j = 1; j <= flatsPerFloor; j++) {
          flats.push({
            flat_number: `${name}-${i}${j.toString().padStart(2, "0")}`,
            floor_id: floor.id,
            block_id: block.id,
          });
        }

        await Flat.bulkCreate(flats);
      }
    }

    // ✅ ROW HOUSE
    if (type === "ROW_HOUSE") {
      const flats = [];
      const defaultArea = area_sqft ? parseFloat(area_sqft) : null;

      for (let i = 1; i <= flats_per_floor; i++) {
        flats.push({
          flat_number: `${name}-${i}`,
          floor_id: null,
          block_id: block.id,
          area_sqft: defaultArea && !isNaN(defaultArea) ? defaultArea : null,
        });
      }

      await Flat.bulkCreate(flats);
    }

    res.status(201).json({
      message: "Block created successfully",
      block,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

const getBlocksBySociety = async (req, res) => {
  try {
    const blocks = await Block.findAll({
      where: { society_id: req.params.societyId },
      include: [{ model: Floor, attributes: ["id"] }],
    });

    const formatted = blocks.map((b) => ({
      id: b.id,
      name: b.name,
      property_type: b.property_type,
      floorCount:
        b.property_type === "ROW_HOUSE"
          ? null
          : b.Floors?.length || 0,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteBlock = async (req, res) => {
  const { blockId } = req.params;

  try {
    const floors = await Floor.findAll({ where: { block_id: blockId } });
    const floorIds = floors.map((f) => f.id);

    // Find all flats in this block/floors
    const flats = await Flat.findAll({
      where: {
        [Op.or]: [
          { floor_id: floorIds },
          { block_id: blockId },
        ],
      },
      attributes: ["id"],
    });
    const flatIds = flats.map((f) => f.id);

    if (flatIds.length > 0) {
      await FlatMembership.destroy({ where: { flat_id: { [Op.in]: flatIds } } });
      await ParkingSlot.update(
        { flat_id: null, resident_id: null, status: "AVAILABLE" },
        { where: { flat_id: { [Op.in]: flatIds } } }
      );
      await Vehicle.destroy({ where: { flat_id: { [Op.in]: flatIds } } });
      await HouseHoldMember.destroy({ where: { flat_id: { [Op.in]: flatIds } } });
      await Flat.destroy({ where: { id: { [Op.in]: flatIds } } });
    }

    await Floor.destroy({ where: { block_id: blockId } });
    await Block.destroy({ where: { id: blockId } });

    res.json({ message: "Block deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSocietyName = async (req, res) => {
  const { societyId } = req.params;
  const society = await Society.findByPk(societyId, {
    attributes: ["id", "name"],
  });
  res.json(society);
};

module.exports = {
  createBlock,
  getBlocksBySociety,
  deleteBlock,
  getSocietyName,
};