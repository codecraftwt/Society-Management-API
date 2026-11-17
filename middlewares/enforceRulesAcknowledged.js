const { Rule, RuleVersion, RuleAcknowledgement } = require("../models");
const { Op } = require("sequelize");

/**
 * Middleware: Enforces that residents have acknowledged all current mandatory rules
 * for their society before allowing operational write operations.
 *
 * Exemptions:
 * - Non-residents (e.g. Super Admin, Outsider Accountant, Society Admin acting as admin)
 * - Safe HTTP methods (GET, HEAD, OPTIONS)
 * - Emergency alerts and payment processing
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id || !req.user.society_id) {
      return next();
    }

    // Always allow safe read methods
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Only apply if user is acting as a resident or is resident of this society
    const isResident =
      req.user.is_society_resident === true ||
      req.user.activeRole === "RESIDENT" ||
      req.user.activeRole === "FAMILY_MEMBER";

    if (!isResident) {
      return next();
    }

    // Fetch current mandatory versions for active rules of this society
    const mandatoryVersions = await RuleVersion.findAll({
      where: {
        society_id: req.user.society_id,
        is_current: true,
        is_mandatory: true,
      },
      include: [
        {
          model: Rule,
          as: "rule",
          where: { is_active: true },
          required: true,
          attributes: ["id"],
        },
      ],
      attributes: ["id"],
    });

    if (!mandatoryVersions || mandatoryVersions.length === 0) {
      return next();
    }

    const versionIds = mandatoryVersions.map((v) => v.id);

    // Check acknowledgements for this user
    const acknowledged = await RuleAcknowledgement.findAll({
      where: {
        user_id: req.user.id,
        society_id: req.user.society_id,
        rule_version_id: { [Op.in]: versionIds },
      },
      attributes: ["rule_version_id"],
    });

    const acknowledgedSet = new Set(acknowledged.map((a) => a.rule_version_id));
    const pendingCount = versionIds.filter((id) => !acknowledgedSet.has(id)).length;

    if (pendingCount > 0) {
      return res.status(403).json({
        code: "RULES_ACKNOWLEDGEMENT_REQUIRED",
        message: "You must review and acknowledge mandatory society rules before performing this action.",
        pending_rules_count: pendingCount,
      });
    }

    next();
  } catch (err) {
    console.error("[enforceRulesAcknowledged] Error checking pending rules:", err);
    return res.status(500).json({ message: "Failed to verify rules acknowledgement status" });
  }
};

