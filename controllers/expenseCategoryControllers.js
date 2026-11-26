const { Op } = require("sequelize");
const { sequelize, ExpenseCategory, Expense } = require("../models");
const { auditLog } = require("../utils/ledgerService");

function resolveSocietyId(req) {
  if (req.user.activeRole === "SUPER_ADMIN") {
    return parseInt(req.headers["x-society-id"] || req.query.society_id || req.body?.society_id, 10) || req.user.society_id;
  }
  return req.user.society_id;
}

const listCategories = async (req, res) => {
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) return res.status(400).json({ success: false, message: "Society could not be resolved." });

    const where = { society_id: societyId };
    if (req.query.status && ["ACTIVE", "INACTIVE"].includes(req.query.status.toUpperCase())) {
      where.status = req.query.status.toUpperCase();
    }

    const categories = await ExpenseCategory.findAll({
      where,
      order: [["name", "ASC"]],
    });

    const [usageRows] = await sequelize.query(
      `SELECT expense_category_id, COUNT(*) AS cnt
       FROM expenses
       WHERE society_id = ? AND expense_category_id IS NOT NULL
       GROUP BY expense_category_id`,
      { replacements: [societyId] }
    );
    const usageMap = new Map(usageRows.map((r) => [Number(r.expense_category_id), Number(r.cnt)]));

    const data = categories.map((c) => ({
      ...c.toJSON(),
      usage_count: usageMap.get(c.id) || 0,
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error("[listCategories]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createCategory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Society could not be resolved." });
    }

    const name = String(req.body.name || "").trim();
    const description = req.body.description ? String(req.body.description).trim() : null;
    if (!name) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Category name is required." });
    }

    const dup = await ExpenseCategory.findOne({
      where: { society_id: societyId, name },
      transaction: t,
    });
    if (dup) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "A category with this name already exists." });
    }

    const cat = await ExpenseCategory.create(
      {
        society_id: societyId,
        name,
        description,
        status: "ACTIVE",
        created_by: req.user.id,
      },
      { transaction: t }
    );

    await auditLog({
      societyId,
      action: "EXPENSE_CATEGORY_CREATE",
      entityType: "ExpenseCategory",
      entityId: cat.id,
      newValue: cat.toJSON(),
      reason: `Created expense category "${name}"`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ success: true, data: cat, message: "Expense category created." });
  } catch (err) {
    await t.rollback();
    console.error("[createCategory]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCategory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const cat = await ExpenseCategory.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!cat) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Expense category not found." });
    }

    const oldVal = cat.toJSON();
    const updates = {};
    if (req.body.name !== undefined) {
      const cleanName = String(req.body.name).trim();
      if (!cleanName) {
        await t.rollback();
        return res.status(400).json({ success: false, message: "Category name cannot be empty." });
      }
      const dup = await ExpenseCategory.findOne({
        where: { society_id: societyId, name: cleanName, id: { [Op.ne]: cat.id } },
        transaction: t,
      });
      if (dup) {
        await t.rollback();
        return res.status(409).json({ success: false, message: "Another category with this name already exists." });
      }
      updates.name = cleanName;
    }
    if (req.body.description !== undefined) {
      updates.description = req.body.description ? String(req.body.description).trim() : null;
    }
    if (req.body.status && ["ACTIVE", "INACTIVE"].includes(req.body.status.toUpperCase())) {
      updates.status = req.body.status.toUpperCase();
    }

    await cat.update(updates, { transaction: t });

    await auditLog({
      societyId,
      action: "EXPENSE_CATEGORY_UPDATE",
      entityType: "ExpenseCategory",
      entityId: cat.id,
      oldValue: oldVal,
      newValue: cat.toJSON(),
      reason: `Updated expense category "${cat.name}"`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, data: cat, message: "Expense category updated." });
  } catch (err) {
    await t.rollback();
    console.error("[updateCategory]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteCategory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = resolveSocietyId(req);
    const cat = await ExpenseCategory.findOne({
      where: { id: req.params.id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!cat) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Expense category not found." });
    }

    const usedCount = await Expense.count({
      where: { expense_category_id: cat.id, society_id: societyId },
      transaction: t,
    });

    if (usedCount > 0) {
      await cat.update({ status: "INACTIVE" }, { transaction: t });
      await auditLog({
        societyId,
        action: "EXPENSE_CATEGORY_DELETE",
        entityType: "ExpenseCategory",
        entityId: cat.id,
        oldValue: { status: "ACTIVE" },
        newValue: { status: "INACTIVE" },
        reason: `Deactivated category "${cat.name}" (referenced by ${usedCount} expense(s))`,
        actor: req.user,
        transaction: t,
      });
      await t.commit();
      return res.json({
        success: true,
        deactivated: true,
        data: cat,
        message: "Category is linked to historical expenses, so it was deactivated instead of deleted.",
      });
    }

    const snapshot = cat.toJSON();
    await cat.destroy({ transaction: t });
    await auditLog({
      societyId,
      action: "EXPENSE_CATEGORY_DELETE",
      entityType: "ExpenseCategory",
      entityId: snapshot.id,
      oldValue: snapshot,
      newValue: null,
      reason: `Deleted unused expense category "${snapshot.name}"`,
      actor: req.user,
      transaction: t,
    });

    await t.commit();
    return res.json({ success: true, deactivated: false, message: "Expense category deleted." });
  } catch (err) {
    await t.rollback();
    console.error("[deleteCategory]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
