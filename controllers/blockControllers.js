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



const getBlockDetail = async (req, res) => {
  try {
    const { blockId } = req.params;
    const block = await Block.findByPk(blockId, {
      include: [
        {
          model: Floor,
          include: [
            {
              model: Flat,
              attributes: ["id", "flat_number", "flat_type", "area_sqft", "occupancy_status", "resident_id", "floor_id", "block_id"],
            },
          ],
        },
        {
          model: Flat,
          attributes: ["id", "flat_number", "flat_type", "area_sqft", "occupancy_status", "resident_id", "floor_id", "block_id"],
        },
      ],
      order: [
        [Floor, "floor_number", "ASC"],
      ],
    });

    if (!block) {
      return res.status(404).json({ message: "Block not found" });
    }

    const floors = (block.Floors || []).map((fl) => ({
      id: fl.id,
      floor_number: isNaN(Number(fl.floor_number)) ? fl.floor_number : Number(fl.floor_number),
      flats: (fl.Flats || []).sort((a, b) => a.flat_number.localeCompare(b.flat_number, undefined, { numeric: true })),
    })).sort((a, b) => {
      const numA = typeof a.floor_number === "number" ? a.floor_number : parseInt(a.floor_number) || 0;
      const numB = typeof b.floor_number === "number" ? b.floor_number : parseInt(b.floor_number) || 0;
      return numA - numB;
    });

    const allFlats = (block.Flats || []).sort((a, b) =>
      a.flat_number.localeCompare(b.flat_number, undefined, { numeric: true })
    );

    const floorCount = block.property_type === "ROW_HOUSE" ? null : floors.length;
    let flatsPerFloor = 0;
    if (floors.length > 0) {
      flatsPerFloor = Math.max(...floors.map((f) => f.flats.length), 0);
    } else if (block.property_type === "ROW_HOUSE") {
      flatsPerFloor = allFlats.length;
    }

    let defaultBhk = "2BHK";
    const bhkFreq = {};
    allFlats.forEach(f => {
      if (f.flat_type) {
        bhkFreq[f.flat_type] = (bhkFreq[f.flat_type] || 0) + 1;
      }
    });
    const sortedBhk = Object.keys(bhkFreq).sort((a, b) => bhkFreq[b] - bhkFreq[a]);
    if (sortedBhk.length > 0) {
      defaultBhk = sortedBhk[0];
    }

    const flatsWithArea = allFlats.filter(f => f.area_sqft != null && Number(f.area_sqft) > 0);
    const commonArea = flatsWithArea.length > 0 ? flatsWithArea[0].area_sqft : null;

    res.json({
      id: block.id,
      name: block.name,
      society_id: block.society_id,
      property_type: block.property_type,
      floor_count: floorCount,
      flats_per_floor: flatsPerFloor,
      totalHouses: block.property_type === "ROW_HOUSE" ? allFlats.length : null,
      commonArea,
      defaultBhk,
      floors,
      allFlats,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const updateBlock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { blockId } = req.params;
    const {
      name,
      property_type,
      floor_count,
      flats_per_floor,
      area_sqft,
      floors,
      flats: customFlats,
    } = req.body;

    const block = await Block.findByPk(blockId, { transaction: t });
    if (!block) {
      await t.rollback();
      return res.status(404).json({ message: "Block not found" });
    }

    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      req.user?.role === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && req.user?.society_id && block.society_id !== req.user.society_id) {
      await t.rollback();
      return res.status(403).json({ message: "Unauthorized to update this block." });
    }

    const targetType = TYPE_MAP[property_type] || property_type || block.property_type || "APARTMENT";
    if (property_type !== undefined && !["APARTMENT", "ROW_HOUSE", "COMMERCIAL"].includes(targetType)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid property type." });
    }

    let sanitizedName = block.name;
    if (name !== undefined) {
      sanitizedName = sanitizeText(name);
      if (isEmpty(sanitizedName)) {
        await t.rollback();
        return res.status(400).json({ message: "Block name cannot be empty." });
      }
      const duplicate = await Block.findOne({
        where: {
          society_id: block.society_id,
          name: sanitizedName,
          id: { [Op.ne]: blockId },
        },
        transaction: t,
      });
      if (duplicate) {
        await t.rollback();
        return res.status(400).json({ message: `Block "${sanitizedName}" already exists in this society.` });
      }
    }

    await block.update({
      name: sanitizedName,
      property_type: targetType,
    }, { transaction: t });

    // Handle APARTMENT / COMMERCIAL layout or floor/unit update
    if (targetType === "APARTMENT" || targetType === "COMMERCIAL") {
      const existingFloors = await Floor.findAll({ where: { block_id: blockId }, transaction: t });
      const existingFlats = await Flat.findAll({ where: { block_id: blockId }, transaction: t });

      const existingFlatMapById = {};
      const existingFlatMapByNum = {};
      existingFlats.forEach((fl) => {
        existingFlatMapById[fl.id] = fl;
        existingFlatMapByNum[fl.flat_number.trim().toLowerCase()] = fl;
      });

      const existingFloorMapByNum = {};
      existingFloors.forEach((fl) => {
        existingFloorMapByNum[String(fl.floor_number).trim()] = fl;
      });

      const retainedFloorIds = new Set();
      const retainedFlatIds = new Set();

      if (Array.isArray(floors) && floors.length > 0) {
        for (let i = 0; i < floors.length; i++) {
          const fData = floors[i];
          const floorNumStr = fData.floor_number != null ? `${fData.floor_number}` : `${i + 1}`;

          let floorRecord = existingFloorMapByNum[floorNumStr];
          if (!floorRecord) {
            floorRecord = await Floor.create({
              floor_number: floorNumStr,
              block_id: block.id,
            }, { transaction: t });
          }
          retainedFloorIds.add(floorRecord.id);

          if (Array.isArray(fData.flats)) {
            for (const flData of fData.flats) {
              const trimmedNum = (flData.flat_number || "").trim();
              if (!trimmedNum) continue;

              let flatRecord = null;
              if (flData.id && existingFlatMapById[flData.id]) {
                flatRecord = existingFlatMapById[flData.id];
              } else if (existingFlatMapByNum[trimmedNum.toLowerCase()]) {
                flatRecord = existingFlatMapByNum[trimmedNum.toLowerCase()];
              }

              const flatTypeVal = flData.flat_type && ["1BHK", "2BHK", "3BHK"].includes(flData.flat_type)
                ? flData.flat_type
                : (flatRecord?.flat_type || "2BHK");

              const areaVal = flData.area_sqft != null && !isNaN(Number(flData.area_sqft)) && Number(flData.area_sqft) > 0
                ? Number(flData.area_sqft)
                : (flatRecord?.area_sqft || null);

              const occVal = flData.occupancy_status && ["VACANT", "RENTED", "OWNER_OCCUPIED"].includes(flData.occupancy_status)
                ? flData.occupancy_status
                : (flatRecord?.occupancy_status || "VACANT");

              if (flatRecord) {
                await flatRecord.update({
                  flat_number: trimmedNum,
                  flat_type: flatTypeVal,
                  area_sqft: areaVal,
                  occupancy_status: occVal,
                  floor_id: floorRecord.id,
                  block_id: block.id,
                }, { transaction: t });
                retainedFlatIds.add(flatRecord.id);
              } else {
                const newFlat = await Flat.create({
                  flat_number: trimmedNum,
                  flat_type: flatTypeVal,
                  area_sqft: areaVal,
                  occupancy_status: occVal,
                  floor_id: floorRecord.id,
                  block_id: block.id,
                }, { transaction: t });
                retainedFlatIds.add(newFlat.id);
              }
            }
          }
        }
      } else if (floor_count || flats_per_floor) {
        // Parametric update without custom layout array
        const fc = parseInt(floor_count) || existingFloors.length || 1;
        const fp = parseInt(flats_per_floor) || (existingFlats.length && existingFloors.length ? Math.ceil(existingFlats.length / existingFloors.length) : 4);

        for (let f = 1; f <= fc; f++) {
          const floorNumStr = `${f}`;
          let floorRecord = existingFloorMapByNum[floorNumStr];
          if (!floorRecord) {
            floorRecord = await Floor.create({
              floor_number: floorNumStr,
              block_id: block.id,
            }, { transaction: t });
          }
          retainedFloorIds.add(floorRecord.id);

          for (let u = 1; u <= fp; u++) {
            const defaultFlatNum = `${sanitizedName}-${f}${u.toString().padStart(2, "0")}`;
            let flatRecord = existingFlatMapByNum[defaultFlatNum.toLowerCase()];

            if (!flatRecord) {
              const floorFlats = existingFlats.filter(fl => fl.floor_id === floorRecord.id);
              if (floorFlats[u - 1]) {
                flatRecord = floorFlats[u - 1];
              }
            }

            if (flatRecord) {
              await flatRecord.update({
                flat_number: defaultFlatNum,
                floor_id: floorRecord.id,
                block_id: block.id,
              }, { transaction: t });
              retainedFlatIds.add(flatRecord.id);
            } else {
              const newFlat = await Flat.create({
                flat_number: defaultFlatNum,
                floor_id: floorRecord.id,
                block_id: block.id,
                flat_type: "2BHK",
                occupancy_status: "VACANT",
              }, { transaction: t });
              retainedFlatIds.add(newFlat.id);
            }
          }
        }
      } else {
        existingFloors.forEach(f => retainedFloorIds.add(f.id));
        existingFlats.forEach(fl => retainedFlatIds.add(fl.id));
      }

      // Safeguard check for surplus flats before removing
      const surplusFlats = existingFlats.filter(fl => !retainedFlatIds.has(fl.id));
      for (const surplus of surplusFlats) {
        if (surplus.resident_id) {
          await t.rollback();
          return res.status(400).json({
            message: `Cannot remove flat "${surplus.flat_number}" because a resident is assigned to it. Please reassign or vacate the unit first.`,
          });
        }
        const activeMembership = await FlatMembership.findOne({
          where: { flat_id: surplus.id, is_current: true },
          transaction: t,
        });
        if (activeMembership) {
          await t.rollback();
          return res.status(400).json({
            message: `Cannot remove flat "${surplus.flat_number}" because an active membership exists. Please remove membership first.`,
          });
        }
      }

      if (surplusFlats.length > 0) {
        const surplusIds = surplusFlats.map(f => f.id);
        await FlatMembership.destroy({ where: { flat_id: { [Op.in]: surplusIds } }, transaction: t });
        await ParkingSlot.update(
          { flat_id: null, resident_id: null, status: "AVAILABLE" },
          { where: { flat_id: { [Op.in]: surplusIds } }, transaction: t }
        );
        await Vehicle.destroy({ where: { flat_id: { [Op.in]: surplusIds } }, transaction: t });
        await HouseHoldMember.destroy({ where: { flat_id: { [Op.in]: surplusIds } }, transaction: t });
        await Flat.destroy({ where: { id: { [Op.in]: surplusIds } }, transaction: t });
      }

      // Surplus floors
      const surplusFloors = existingFloors.filter(f => !retainedFloorIds.has(f.id));
      if (surplusFloors.length > 0) {
        const surplusFloorIds = surplusFloors.map(f => f.id);
        await Floor.destroy({ where: { id: { [Op.in]: surplusFloorIds } }, transaction: t });
      }
    }

    // Handle ROW_HOUSE
    if (targetType === "ROW_HOUSE") {
      const existingFlats = await Flat.findAll({ where: { block_id: blockId }, transaction: t });
      const defaultArea = area_sqft && !isNaN(Number(area_sqft)) ? Number(area_sqft) : null;

      if (Array.isArray(customFlats) && customFlats.length > 0) {
        const retainedIds = new Set();
        for (const cf of customFlats) {
          const trimmedNum = (cf.flat_number || "").trim();
          if (!trimmedNum) continue;

          let flatRecord = null;
          if (cf.id) {
            flatRecord = existingFlats.find(f => f.id === cf.id);
          }
          if (!flatRecord && trimmedNum) {
            flatRecord = existingFlats.find(f => f.flat_number.trim().toLowerCase() === trimmedNum.toLowerCase());
          }

          const areaVal = cf.area_sqft != null && !isNaN(Number(cf.area_sqft)) && Number(cf.area_sqft) > 0
            ? Number(cf.area_sqft)
            : defaultArea || flatRecord?.area_sqft || null;

          const occVal = cf.occupancy_status && ["VACANT", "RENTED", "OWNER_OCCUPIED"].includes(cf.occupancy_status)
            ? cf.occupancy_status
            : flatRecord?.occupancy_status || "VACANT";

          if (flatRecord) {
            await flatRecord.update({
              flat_number: trimmedNum,
              area_sqft: areaVal,
              occupancy_status: occVal,
              floor_id: null,
              block_id: block.id,
            }, { transaction: t });
            retainedIds.add(flatRecord.id);
          } else {
            const newF = await Flat.create({
              flat_number: trimmedNum,
              area_sqft: areaVal,
              occupancy_status: occVal,
              floor_id: null,
              block_id: block.id,
            }, { transaction: t });
            retainedIds.add(newF.id);
          }
        }

        const surplusFlats = existingFlats.filter(f => !retainedIds.has(f.id));
        for (const surplus of surplusFlats) {
          if (surplus.resident_id) {
            await t.rollback();
            return res.status(400).json({
              message: `Cannot remove house "${surplus.flat_number}" because a resident is assigned to it.`,
            });
          }
        }
        if (surplusFlats.length > 0) {
          const sIds = surplusFlats.map(f => f.id);
          await FlatMembership.destroy({ where: { flat_id: { [Op.in]: sIds } }, transaction: t });
          await Flat.destroy({ where: { id: { [Op.in]: sIds } }, transaction: t });
        }
      } else if (flats_per_floor) {
        const total = parseInt(flats_per_floor);
        if (!isNaN(total) && total > 0) {
          if (total > existingFlats.length) {
            const toAdd = [];
            for (let i = existingFlats.length + 1; i <= total; i++) {
              toAdd.push({
                flat_number: `${sanitizedName}-${i}`,
                floor_id: null,
                block_id: block.id,
                occupancy_status: "VACANT",
                area_sqft: defaultArea,
              });
            }
            await Flat.bulkCreate(toAdd, { transaction: t });
          } else if (total < existingFlats.length) {
            const surplus = existingFlats.slice(total);
            for (const sf of surplus) {
              if (sf.resident_id) {
                await t.rollback();
                return res.status(400).json({
                  message: `Cannot reduce total houses because house "${sf.flat_number}" has an assigned resident.`,
                });
              }
            }
            const sIds = surplus.map(f => f.id);
            await FlatMembership.destroy({ where: { flat_id: { [Op.in]: sIds } }, transaction: t });
            await Flat.destroy({ where: { id: { [Op.in]: sIds } }, transaction: t });
          }
        }
      }

      if (defaultArea) {
        await Flat.update(
          { area_sqft: defaultArea },
          { where: { block_id: block.id, area_sqft: null }, transaction: t }
        );
      }
    }

    await t.commit();

    const updatedBlock = await Block.findByPk(blockId, {
      include: [
        { model: Floor, attributes: ["id", "floor_number"] },
      ],
    });

    res.json({
      message: "Block updated successfully",
      block: {
        id: updatedBlock.id,
        name: updatedBlock.name,
        property_type: updatedBlock.property_type,
        floorCount: updatedBlock.property_type === "ROW_HOUSE" ? null : (updatedBlock.Floors?.length || 0),
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("updateBlock error:", err);
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
  getBlockDetail,
  getBlocksBySociety,
  updateBlock,
  deleteBlock,
  getSocietyName,
};
