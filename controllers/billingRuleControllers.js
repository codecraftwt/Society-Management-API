const { BillingRule } = require("../models");

const getBillingRules = async (req, res) => {
  try {
    const rules = await BillingRule.findAll({
      where: { society_id: req.user.society_id },
      order: [["created_at", "DESC"]],
    });

    return res.json(rules);
  } catch (err) {
    console.error("[getBillingRules]", err);
    return res.status(500).json({ message: err.message });
  }
};

const createBillingRule = async (req, res) => {
  try {
    const { name, amount, frequency = "MONTHLY", description = "" } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ message: "amount is required and must be a number" });
    }

    const allowed = ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME"];
    if (!allowed.includes(frequency)) {
      return res.status(400).json({ message: `frequency must be one of: ${allowed.join(", ")}` });
    }

    const rule = await BillingRule.create({
      society_id: req.user.society_id,
      name: String(name).trim(),
      amount: Number(amount),
      frequency,
      description: String(description || "").trim(),
    });

    return res.status(201).json(rule);
  } catch (err) {
    console.error("[createBillingRule]", err);
    return res.status(500).json({ message: err.message });
  }
};

const deleteBillingRule = async (req, res) => {
  try {
    const rule = await BillingRule.findOne({
      where: {
        id: req.params.id,
        society_id: req.user.society_id,
      },
    });

    if (!rule) {
      return res.status(404).json({ message: "Billing rule not found" });
    }

    await rule.destroy();
    return res.json({ message: "Billing rule deleted successfully" });
  } catch (err) {
    console.error("[deleteBillingRule]", err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getBillingRules,
  createBillingRule,
  deleteBillingRule,
};
