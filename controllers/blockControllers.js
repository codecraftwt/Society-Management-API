const Block = require("../models/Block");
const Floor = require("../models/Floor");
const Flat = require("../models/Flat");
const Society = require("../models/Society");
const FlatMembership = require("../models/FlatMembership");
const ParkingSlot = require("../models/ParkingSlot");
const Vehicle = require("../models/Vehicle");
const HouseHoldMember = require("../models/HouseHoldMember");

const { Op } = require("sequelize");
const {
  sanitizeText,
  isEmpty,
  isPositiveNumber,
} = require("../utils/validation");

const sequelize = require("../config/db");

const TYPE_MAP = { "Apartments": "APARTMENT", "Row Houses": "ROW_HOUSE", "Commercial": "COMMERCIAL" };

const createBlock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      name,
      society_id,
      floor_count,
      flats_per_floor,
      property_type,
      area_sqft,
      floors,
    } = req.body;

    const type = TYPE_MAP[property_type] || property_type || "APARTMENT";

    // ✅ SCOPING / RBAC: Derive society ID safely
    let targetSocietyId = society_id;
    if (req.user && req.user.activeRole !== "SUPER_ADMIN") {
      targetSocietyId = req.user.society_id;
    } else if (req.user && req.user.activeRole === "SUPER_ADMIN") {
      targetSocietyId = society_id || req.headers["x-society-id"];
    }

    // ✅ VALIDATION
    if (isEmpty(sanitizeText(name))) {
      await t.rollback();
      return res.status(400).json({
        message: "Block name is required.",
      });
    }
    if (isEmpty(targetSocietyId)) {
      await t.rollback();
      return res.status(400).json({ message: "Society is required." });
    }
    if (!["APARTMENT", "ROW_HOUSE", "COMMERCIAL"].includes(type)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid property type." });
    }

    if (type === "APARTMENT" || type === "COMMERCIAL") {
      const floorCount = parseInt(floor_count);
      const flatsPerFloor = parseInt(flats_per_floor);
      if (!floorCount || isNaN(floorCount) || floorCount < 1) {
        await t.rollback();
        return res.status(400).json({ message: "floor_count must be a positive number." });
      }
      if (!flatsPerFloor || isNaN(flatsPerFloor) || flatsPerFloor < 1) {
        await t.rollback();
        return res.status(400).json({ message: "flats_per_floor must be a positive number." });
      }

      // If custom layout with floors/flats was provided, validate thoroughly
      if (floors !== undefined && floors !== null) {
        if (!Array.isArray(floors) || floors.length !== floorCount) {
          await t.rollback();
          return res.status(400).json({
            message: `Layout must contain exactly ${floorCount} floor(s).`,
          });
        }

        const flatNumberSet = new Set();
        for (let i = 0; i < floors.length; i++) {
          const f = floors[i];
          if (!f || !Array.isArray(f.flats) || f.flats.length !== flatsPerFloor) {
            await t.rollback();
            return res.status(400).json({
              message: `Floor ${i + 1} must contain exactly ${flatsPerFloor} flat(s).`,
            });
          }

          for (const fl of f.flats) {
            if (!fl || !fl.flat_number || typeof fl.flat_number !== "string" || !fl.flat_number.trim()) {
              await t.rollback();
              return res.status(400).json({
                message: `Every flat must have a valid flat_number.`,
              });
            }
            const trimmedNum = fl.flat_number.trim();
            if (flatNumberSet.has(trimmedNum)) {
              await t.rollback();
              return res.status(400).json({
                message: `Duplicate flat number "${trimmedNum}" detected in layout.`,
              });
            }
            flatNumberSet.add(trimmedNum);

            if (type === "APARTMENT") {
              if (!fl.flat_type || !["1BHK", "2BHK", "3BHK"].includes(fl.flat_type)) {
                await t.rollback();
                return res.status(400).json({
                  message: `Flat ${trimmedNum} has an invalid BHK type "${fl.flat_type}". Allowed: 1BHK, 2BHK, 3BHK.`,
                });
              }
            } else if (fl.flat_type && !["1BHK", "2BHK", "3BHK"].includes(fl.flat_type)) {
              await t.rollback();
              return res.status(400).json({
                message: `Flat ${trimmedNum} has an invalid flat_type "${fl.flat_type}". Allowed: 1BHK, 2BHK, 3BHK.`,
              });
            }
          }
        }
      }
    }

    if (type === "ROW_HOUSE") {
      const flatsPerFloor = parseInt(flats_per_floor);
      if (!flatsPerFloor || isNaN(flatsPerFloor) || flatsPerFloor < 1) {
        await t.rollback();
        return res.status(400).json({ message: "Number of row houses must be a positive number." });
      }
      if (area_sqft != null && !isPositiveNumber(area_sqft)) {
        await t.rollback();
        return res.status(400).json({ message: "area_sqft must be a positive number." });
      }
    }

    if (type === "ROW_HOUSE" && floor_count) {
      await t.rollback();
      return res.status(400).json({
        message: "Row House should not have floor_count",
      });
    }

    // ✅ CREATE BLOCK TRANSACTIONALLY
    const block = await Block.create({
      name,
      society_id: targetSocietyId,
      property_type: type,
    }, { transaction: t });

    // ✅ APARTMENT / COMMERCIAL
    if (type === "APARTMENT" || type === "COMMERCIAL") {
      const floorCount = parseInt(floor_count);
      const flatsPerFloor = parseInt(flats_per_floor);

      if (Array.isArray(floors) && floors.length === floorCount) {
        for (let i = 0; i < floorCount; i++) {
          const fData = floors[i];
          const floorNumber = fData.floor_number != null ? `${fData.floor_number}` : `${i + 1}`;
          const floor = await Floor.create({
            floor_number: floorNumber,
            block_id: block.id,
          }, { transaction: t });

          const flatsToInsert = fData.flats.map((fl) => ({
            flat_number: fl.flat_number.trim(),
            flat_type: fl.flat_type || null,
            floor_id: floor.id,
            block_id: block.id,
            occupancy_status: "VACANT",
          }));

          await Flat.bulkCreate(flatsToInsert, { transaction: t });
        }
      } else {
        // Fallback for legacy callers without floors payload
        for (let i = 1; i <= floorCount; i++) {
          const floor = await Floor.create({
            floor_number: `${i}`,
            block_id: block.id,
          }, { transaction: t });

          const flats = [];
          for (let j = 1; j <= flatsPerFloor; j++) {
            flats.push({
              flat_number: `${name}-${i}${j.toString().padStart(2, "0")}`,
              floor_id: floor.id,
              block_id: block.id,
              occupancy_status: "VACANT",
            });
          }

          await Flat.bulkCreate(flats, { transaction: t });
        }
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
          occupancy_status: "VACANT",
          area_sqft: defaultArea && !isNaN(defaultArea) ? defaultArea : null,
        });
      }

      await Flat.bulkCreate(flats, { transaction: t });
    }

    await t.commit();

    res.status(201).json({
      message: "Block created successfully",
      block,
    });

  } catch (err) {
    if (t && !t.finished) {
      await t.rollback();
    }
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
    const block = await Block.findByPk(blockId);
    if (!block) return res.status(404).json({ message: "Block not found" });

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
