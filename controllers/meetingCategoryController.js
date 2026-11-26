const { sequelize, MeetingCategory, MeetingMinutes } = require("../models");

const DEFAULT_CATEGORIES = [
  { name: "Committee Meeting", description: "Regular management committee meetings" },
  { name: "Annual General Meeting", description: "Annual general body meetings (AGM)" },
  { name: "Emergency Meeting", description: "Urgent society governance or safety meetings" },
  { name: "Maintenance Discussion", description: "Building repairs, vendor & maintenance reviews" },
];

function resolveSocietyId(req) {
  const isSuperAdmin =
    req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  if (isSuperAdmin) {
    const raw =
      req.headers["x-society-id"] || req.query.society_id || req.body?.society_id || req.user?.society_id;
    const parsed = raw && raw !== "ALL" ? parseInt(raw, 10) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return req.user?.society_id || null;
}

async function ensureDefaultCategories(societyId, userId = null) {
  const count = await MeetingCategory.count({ where: { society_id: societyId } });
  if (count > 0) return;

  for (const cat of DEFAULT_CATEGORIES) {
    await MeetingCategory.findOrCreate({
      where: { society_id: societyId, name: cat.name },
      defaults: {
        society_id: societyId,
        name: cat.name,
        description: cat.description,
        is_active: true,
        created_by: userId,
      },
    });
  }
}

const listCategories = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    await ensureDefaultCategories(societyId, req.user?.id || null);

    const where = { society_id: societyId };
    if (String(req.query.active_only || "").toLowerCase() === "true") {
      where.is_active = true;
    }

    const categories = await MeetingCategory.findAll({
      where,
      order: [["name", "ASC"]],
    });

    const usageRows = await MeetingMinutes.findAll({
      where: { society_id: societyId },
      attributes: [
        "category_id",
        [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
      ],
      group: ["category_id"],
      raw: true,
    });
    const usageMap = new Map(
      usageRows.map((r) => [Number(r.category_id), Number(r.cnt)])
    );

    const data = categories.map((c) => {
      const obj = typeof c.toJSON === "function" ? c.toJSON() : c;
      return {
        ...obj,
        usage_count: usageMap.get(obj.id) || 0,
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("[meetingCategoryController.listCategories]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch meeting categories." });
  }
};

const createCategory = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const name = String(req.body.name || "").trim();
    const description = req.body.description ? String(req.body.description).trim() : null;

    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Category name must be between 2 and 100 characters.",
      });
    }

    const existing = await MeetingCategory.findOne({
      where: { society_id: societyId, name },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A meeting category with this name already exists.",
      });
    }

    const category = await MeetingCategory.create({
      society_id: societyId,
      name,
      description,
      is_active: true,
      created_by: req.user?.id || null,
    });

    return res.status(201).json({
      success: true,
      data: { ...category.toJSON(), usage_count: 0 },
      message: "Meeting category created.",
    });
  } catch (err) {
    console.error("[meetingCategoryController.createCategory]", err);
    return res.status(500).json({ success: false, message: "Failed to create meeting category." });
  }
};

const updateCategory = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const category = await MeetingCategory.findOne({
      where: { id: req.params.id, society_id: societyId },
    });
    if (!category) {
      return res.status(404).json({ success: false, message: "Meeting category not found." });
    }

    const updates = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name || name.length < 2 || name.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Category name must be between 2 and 100 characters.",
        });
      }
      if (name !== category.name) {
        const dup = await MeetingCategory.findOne({
          where: { society_id: societyId, name },
        });
        if (dup) {
          return res.status(409).json({
            success: false,
            message: "Another category with this name already exists.",
          });
        }
      }
      updates.name = name;
    }

    if (req.body.description !== undefined) {
      updates.description = req.body.description ? String(req.body.description).trim() : null;
    }
    if (req.body.is_active !== undefined) {
      updates.is_active = Boolean(req.body.is_active);
    }

    await category.update(updates);
    return res.json({
      success: true,
      data: category,
      message: "Meeting category updated.",
    });
  } catch (err) {
    console.error("[meetingCategoryController.updateCategory]", err);
    return res.status(500).json({ success: false, message: "Failed to update meeting category." });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required." });
    }

    const category = await MeetingCategory.findOne({
      where: { id: req.params.id, society_id: societyId },
    });
    if (!category) {
      return res.status(404).json({ success: false, message: "Meeting category not found." });
    }

    const usedCount = await MeetingMinutes.count({
      where: { category_id: category.id, society_id: societyId },
      paranoid: false,
    });

    if (usedCount > 0) {
      await category.update({ is_active: false });
      return res.json({
        success: true,
        deactivated: true,
        message: "Category is linked to existing meetings and has been deactivated.",
      });
    }

    await category.destroy();
    return res.json({
      success: true,
      deactivated: false,
      message: "Meeting category deleted.",
    });
  } catch (err) {
    console.error("[meetingCategoryController.deleteCategory]", err);
    return res.status(500).json({ success: false, message: "Failed to delete meeting category." });
  }
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  ensureDefaultCategories,
};
