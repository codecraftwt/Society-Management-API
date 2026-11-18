const { Rule, RuleVersion, RuleAcknowledgement, Society, User, Flat, FlatMembership, UserSociety, Block, HouseHoldMember, sequelize } = require("../models");
const { Op } = require("sequelize");
const { getSocietyMemberUserIds } = require("../utils/accessHelpers");
const notificationService = require("../services/notificationService");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function parseSafePositiveInteger(val) {
  if (val === null || val === undefined || val === "") return null;
  const raw = Array.isArray(val) ? val[0] : val;
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function getTargetSocietyId(req) {
  const isSuperAdmin =
    req.user?.activeRole === "SUPER_ADMIN" ||
    (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

  if (isSuperAdmin) {
    const raw =
      req.query.society_id ||
      req.headers["x-society-id"] ||
      req.body?.society_id ||
      req.user?.society_id;
    if (raw && raw !== "ALL") {
      return parseSafePositiveInteger(raw);
    }
    return null;
  }

  return parseSafePositiveInteger(req.user?.society_id);
}

function pipeUpstreamPdf(targetUrl, filename, res) {
  if (!targetUrl) {
    return res.status(400).json({ message: "No document file available" });
  }

  // Handle local filesystem paths
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    const resolvedPath = path.resolve(targetUrl);
    if (fs.existsSync(resolvedPath)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename || "rule.pdf")}"`);
      return fs.createReadStream(resolvedPath).pipe(res);
    }
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ message: "Invalid document URL" });
  }

  const transport = parsed.protocol === "https:" ? https : http;

  const fetchWithRedirects = (url, depth = 5) => {
    if (depth <= 0) {
      return res.status(502).json({ message: "Too many redirects fetching document" });
    }
    transport
      .get(url, (upstream) => {
        if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
          upstream.resume();
          return fetchWithRedirects(upstream.headers.location, depth - 1);
        }
        if (upstream.statusCode !== 200) {
          upstream.resume();
          return res.status(upstream.statusCode).json({ message: "Failed to fetch document" });
        }

        let contentType = upstream.headers["content-type"];
        const fn = (filename || "").toLowerCase();
        if (!contentType || contentType === "application/octet-stream") {
          if (fn.endsWith(".png")) contentType = "image/png";
          else if (fn.endsWith(".jpg") || fn.endsWith(".jpeg")) contentType = "image/jpeg";
          else if (fn.endsWith(".webp")) contentType = "image/webp";
          else if (fn.endsWith(".gif")) contentType = "image/gif";
          else if (fn.endsWith(".svg")) contentType = "image/svg+xml";
          else contentType = "application/pdf";
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename || (contentType.startsWith("image/") ? "rule_image" : "rule.pdf"))}"`);
        if (upstream.headers["content-length"]) {
          res.setHeader("Content-Length", upstream.headers["content-length"]);
        }
        res.setHeader("Cache-Control", "private, max-age=3600");
        upstream.pipe(res);
      })
      .on("error", (err) => {
        console.error("[streamPdf] Upstream error:", err.message);
        if (!res.headersSent) res.status(502).json({ message: "Error streaming document" });
      });
  };

  fetchWithRedirects(targetUrl);
}

/**
 * Public: Fetch active rules and their current versions for pre-registration review
 * GET /auth/registration-rules?society_id=123
 */
exports.getRegistrationRules = async (req, res) => {
  try {
    const societyId = parseSafePositiveInteger(req.query.society_id);
    if (!societyId) {
      return res.status(400).json({ message: "A valid positive society_id is required" });
    }

    const rules = await Rule.findAll({
      where: { society_id: societyId, is_active: true },
      include: [
        {
          model: RuleVersion,
          as: "versions",
          where: { is_current: true },
          required: true,
          attributes: [
            "id",
            "version_number",
            "file_url",
            "document_name",
            "change_summary",
            "is_mandatory",
            "created_at",
          ],
        },
      ],
      order: [["title", "ASC"]],
    });

    const response = rules.map((r) => {
      const current = r.versions && r.versions.length > 0 ? r.versions[0] : null;
      return {
        id: r.id,
        society_id: r.society_id,
        title: r.title,
        category: r.category,
        description: r.description,
        is_mandatory: Boolean(current?.is_mandatory),
        current_version: current,
      };
    });

    return res.status(200).json(response);
  } catch (err) {
    console.error("getRegistrationRules error:", err);
    return res.status(500).json({ message: "Failed to load registration rules" });
  }
};

/**
 * Public: Stream document for registration review
 * GET /auth/registration-rules/:versionId/document
 */
exports.streamRegistrationDocument = async (req, res) => {
  try {
    const versionId = parseSafePositiveInteger(req.params.versionId);
    if (!versionId) return res.status(400).json({ message: "Invalid version ID" });

    const version = await RuleVersion.findByPk(versionId, {
      include: [{ model: Rule, as: "rule", where: { is_active: true }, required: true }],
    });

    if (!version || !version.file_url) {
      return res.status(404).json({ message: "Document not found or rule inactive" });
    }

    pipeUpstreamPdf(version.file_url, version.document_name, res);
  } catch (err) {
    console.error("streamRegistrationDocument error:", err);
    return res.status(500).json({ message: "Failed to stream document" });
  }
};

/**
 * Authenticated: Stream rule version document
 * GET /api/rules/version/:versionId/document
 */
exports.streamRuleDocument = async (req, res) => {
  try {
    const versionId = parseSafePositiveInteger(req.params.versionId);
    if (!versionId) return res.status(400).json({ message: "Invalid version ID" });

    const version = await RuleVersion.findByPk(versionId);
    if (!version || !version.file_url) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Authorization check
    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(version.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Forbidden: cross-society document access" });
    }

    pipeUpstreamPdf(version.file_url, version.document_name, res);
  } catch (err) {
    console.error("streamRuleDocument error:", err);
    return res.status(500).json({ message: "Failed to stream document" });
  }
};

/**
 * Authenticated: List rules for society
 * GET /api/rules
 */
exports.getRules = async (req, res) => {
  try {
    const targetSocietyId = getTargetSocietyId(req);
    if (!targetSocietyId) {
      return res.status(400).json({ message: "Target society_id is required" });
    }

    const isAdmin =
      req.user.activeRole === "SUPER_ADMIN" ||
      req.user.activeRole === "SOCIETY_ADMIN";

    const whereClause = { society_id: targetSocietyId };
    if (!isAdmin || req.query.is_active === "true") {
      whereClause.is_active = true;
    }

    const rules = await Rule.findAll({
      where: whereClause,
      include: [
        {
          model: RuleVersion,
          as: "versions",
          where: { is_current: true },
          required: false,
          include: [
            {
              model: User,
              as: "publisher",
              attributes: ["id", "name", "role"],
            },
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    // Check acknowledgement status for current user if logged in
    let acknowledgedVersionIds = new Set();
    if (req.user?.id) {
      const acks = await RuleAcknowledgement.findAll({
        where: {
          user_id: req.user.id,
          society_id: targetSocietyId,
        },
        attributes: ["rule_version_id"],
      });
      acknowledgedVersionIds = new Set(acks.map((a) => a.rule_version_id));
    }

    const result = rules.map((r) => {
      const current = r.versions && r.versions.length > 0 ? r.versions[0] : null;
      return {
        id: r.id,
        society_id: r.society_id,
        title: r.title,
        category: r.category,
        description: r.description,
        is_active: Boolean(r.is_active),
        created_at: r.created_at,
        updated_at: r.updated_at,
        current_version: current
          ? {
              id: current.id,
              version_number: current.version_number,
              file_url: current.file_url,
              document_name: current.document_name,
              change_summary: current.change_summary,
              is_mandatory: Boolean(current.is_mandatory),
              published_by: current.publisher ? current.publisher.name : null,
              created_at: current.created_at,
            }
          : null,
        is_mandatory: Boolean(current?.is_mandatory),
        is_acknowledged: current ? acknowledgedVersionIds.has(current.id) : false,
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("getRules error:", err);
    return res.status(500).json({ message: "Failed to fetch rules" });
  }
};

/**
 * Authenticated: Get pending mandatory rule versions for logged in resident
 * GET /api/rules/pending
 */
exports.getPendingRules = async (req, res) => {
  try {
    const targetSocietyId =
      req.user?.society_id ||
      parseSafePositiveInteger(req.headers["x-society-id"]) ||
      parseSafePositiveInteger(req.query.society_id);

    if (!targetSocietyId) {
      return res.status(400).json({ message: "Society context required" });
    }

    const activeVersions = await RuleVersion.findAll({
      where: {
        society_id: targetSocietyId,
        is_current: true,
      },
      include: [
        {
          model: Rule,
          as: "rule",
          where: { is_active: true },
          required: true,
          attributes: ["id", "title", "category", "description"],
        },
      ],
      order: [["rule_id", "ASC"]],
    });

    if (activeVersions.length === 0) {
      return res.status(200).json({ pending_rules: [] });
    }

    const versionIds = activeVersions.map((v) => v.id);
    const acknowledged = await RuleAcknowledgement.findAll({
      where: {
        user_id: req.user.id,
        society_id: targetSocietyId,
        rule_version_id: { [Op.in]: versionIds },
      },
      attributes: ["rule_version_id"],
    });

    const acknowledgedSet = new Set(acknowledged.map((a) => a.rule_version_id));
    const pending = activeVersions
      .filter((v) => !acknowledgedSet.has(v.id))
      .map((v) => ({
        version_id: v.id,
        rule_id: v.rule_id,
        title: v.rule.title,
        category: v.rule.category,
        description: v.rule.description,
        version_number: v.version_number,
        document_name: v.document_name,
        file_url: v.file_url,
        change_summary: v.change_summary,
        is_mandatory: Boolean(v.is_mandatory),
        created_at: v.created_at,
      }));

    return res.status(200).json({ pending_rules: pending });
  } catch (err) {
    console.error("getPendingRules error:", err);
    return res.status(500).json({ message: "Failed to fetch pending rules" });
  }
};

/**
 * Authenticated: Get rule by ID with version history
 * GET /api/rules/:id
 */
exports.getRuleById = async (req, res) => {
  try {
    const ruleId = parseSafePositiveInteger(req.params.id);
    if (!ruleId) return res.status(400).json({ message: "Invalid rule ID" });

    const rule = await Rule.findByPk(ruleId, {
      include: [
        {
          model: RuleVersion,
          as: "versions",
          include: [
            {
              model: User,
              as: "publisher",
              attributes: ["id", "name", "role"],
            },
          ],
        },
      ],
      order: [[{ model: RuleVersion, as: "versions" }, "version_number", "DESC"]],
    });

    if (!rule) return res.status(404).json({ message: "Rule not found" });

    // Authorization check
    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(rule.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Forbidden: cross-society access" });
    }

    return res.status(200).json(rule);
  } catch (err) {
    console.error("getRuleById error:", err);
    return res.status(500).json({ message: "Failed to fetch rule details" });
  }
};

/**
 * Authenticated (Super Admin / Society Admin): Create a rule with initial version 1
 * POST /api/rules
 */
exports.createRule = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const targetSocietyId = getTargetSocietyId(req);
    if (!targetSocietyId) {
      await t.rollback();
      return res.status(400).json({ message: "Valid target society_id is required" });
    }

    const { title, category, description, is_mandatory } = req.body;

    if (!title || !title.trim()) {
      await t.rollback();
      return res.status(400).json({ message: "Rule title is required" });
    }
    if (!category || !category.trim()) {
      await t.rollback();
      return res.status(400).json({ message: "Category is required" });
    }
    if (!req.file || !req.file.path) {
      await t.rollback();
      return res.status(400).json({ message: "A document file (PDF or Image) is required" });
    }

    const isMandatoryBool =
      is_mandatory === true || is_mandatory === "true" || is_mandatory === 1 || is_mandatory === "1";

    const rule = await Rule.create(
      {
        society_id: targetSocietyId,
        title: title.trim(),
        category: category.trim(),
        description: description ? description.trim() : null,
        is_active: true,
      },
      { transaction: t }
    );

    const version = await RuleVersion.create(
      {
        rule_id: rule.id,
        society_id: targetSocietyId,
        version_number: 1,
        file_url: req.file.path,
        document_name: req.file.originalname || "rules.pdf",
        change_summary: "Initial version",
        is_mandatory: isMandatoryBool,
        is_current: true,
        published_by_user_id: req.user.id,
      },
      { transaction: t }
    );

    await t.commit();

    // Deferred notification after commit
    notifyRuleEvent(targetSocietyId, req.user.id, rule, version, isMandatoryBool, true);

    return res.status(201).json({
      message: "Rule created successfully",
      rule: {
        ...rule.toJSON(),
        current_version: version,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("createRule error:", err);
    return res.status(500).json({ message: err.message || "Failed to create rule" });
  }
};

/**
 * Authenticated (Super Admin / Society Admin): Update rule metadata
 * PUT /api/rules/:id
 */
exports.updateRule = async (req, res) => {
  try {
    const ruleId = parseSafePositiveInteger(req.params.id);
    if (!ruleId) return res.status(400).json({ message: "Invalid rule ID" });

    const rule = await Rule.findByPk(ruleId);
    if (!rule) return res.status(404).json({ message: "Rule not found" });

    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(rule.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Forbidden: cross-society access" });
    }

    const { title, category, description } = req.body;
    if (title !== undefined) rule.title = title.trim();
    if (category !== undefined) rule.category = category.trim();
    if (description !== undefined) rule.description = description ? description.trim() : null;

    await rule.save();

    return res.status(200).json({ message: "Rule updated successfully", rule });
  } catch (err) {
    console.error("updateRule error:", err);
    return res.status(500).json({ message: "Failed to update rule" });
  }
};

/**
 * Authenticated (Super Admin / Society Admin): Publish a new version of an existing rule
 * POST /api/rules/:id/versions
 */
exports.publishRuleVersion = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const ruleId = parseSafePositiveInteger(req.params.id);
    if (!ruleId) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid rule ID" });
    }

    if (!req.file || !req.file.path) {
      await t.rollback();
      return res.status(400).json({ message: "A document file (PDF or Image) is required" });
    }

    // 1. Lock the parent rule record with FOR UPDATE
    const rule = await Rule.findOne({
      where: { id: ruleId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!rule) {
      await t.rollback();
      return res.status(404).json({ message: "Rule not found" });
    }

    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(rule.society_id) !== String(req.user.society_id)) {
      await t.rollback();
      return res.status(403).json({ message: "Forbidden: cross-society access" });
    }

    const { change_summary, is_mandatory } = req.body;
    const isMandatoryBool =
      is_mandatory === true || is_mandatory === "true" || is_mandatory === 1 || is_mandatory === "1";

    // 2. Fetch current max version_number for this rule
    const maxVersion =
      (await RuleVersion.max("version_number", {
        where: { rule_id: rule.id },
        transaction: t,
      })) || 0;
    const newVersionNumber = maxVersion + 1;

    // 3. Mark existing versions as is_current = false
    await RuleVersion.update(
      { is_current: false },
      {
        where: { rule_id: rule.id, is_current: true },
        transaction: t,
      }
    );

    // 4. Create new version
    const newVersion = await RuleVersion.create(
      {
        rule_id: rule.id,
        society_id: rule.society_id,
        version_number: newVersionNumber,
        file_url: req.file.path,
        document_name: req.file.originalname || `rule_v${newVersionNumber}.pdf`,
        change_summary: change_summary ? change_summary.trim() : null,
        is_mandatory: isMandatoryBool,
        is_current: true,
        published_by_user_id: req.user.id,
      },
      { transaction: t }
    );

    await t.commit();

    // Deferred notification
    notifyRuleEvent(rule.society_id, req.user.id, rule, newVersion, isMandatoryBool, false);

    return res.status(201).json({
      message: `Version ${newVersionNumber} published successfully`,
      version: newVersion,
    });
  } catch (err) {
    await t.rollback();
    console.error("publishRuleVersion error:", err);
    return res.status(500).json({ message: err.message || "Failed to publish new version" });
  }
};

/**
 * Authenticated (Super Admin / Society Admin): Archive / Restore rule
 * PATCH /api/rules/:id/archive
 */
exports.archiveRule = async (req, res) => {
  try {
    const ruleId = parseSafePositiveInteger(req.params.id);
    if (!ruleId) return res.status(400).json({ message: "Invalid rule ID" });

    const rule = await Rule.findByPk(ruleId);
    if (!rule) return res.status(404).json({ message: "Rule not found" });

    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(rule.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Forbidden: cross-society access" });
    }

    const { is_active } = req.body;
    rule.is_active = is_active !== undefined ? Boolean(is_active) : !rule.is_active;
    await rule.save();

    return res.status(200).json({
      message: rule.is_active ? "Rule restored successfully" : "Rule archived successfully",
      rule,
    });
  } catch (err) {
    console.error("archiveRule error:", err);
    return res.status(500).json({ message: "Failed to archive rule" });
  }
};

/**
 * Authenticated: Acknowledge rule versions
 * POST /api/rules/acknowledge
 */
exports.acknowledgeRules = async (req, res) => {
  try {
    const { version_ids, source } = req.body;
    if (!Array.isArray(version_ids) || version_ids.length === 0) {
      return res.status(400).json({ message: "version_ids must be a non-empty array" });
    }

    const cleanIds = version_ids.map(parseSafePositiveInteger).filter(Boolean);
    if (cleanIds.length === 0) {
      return res.status(400).json({ message: "Valid version IDs required" });
    }

    const targetSocietyId =
      req.user?.society_id ||
      parseSafePositiveInteger(req.headers["x-society-id"]);

    // Fetch versions and verify they belong to current user's society and active rules
    const versions = await RuleVersion.findAll({
      where: {
        id: { [Op.in]: cleanIds },
        society_id: targetSocietyId,
        is_current: true,
      },
      include: [
        {
          model: Rule,
          as: "rule",
          where: { is_active: true },
          required: true,
        },
      ],
    });

    if (versions.length !== cleanIds.length) {
      return res.status(400).json({
        message: "One or more rule versions are invalid, outdated, or not applicable to your society",
      });
    }

    const sourceEnum = ["REGISTRATION", "LOGIN_GATE", "PORTAL"].includes(source)
      ? source
      : "LOGIN_GATE";

    const ackRecords = versions.map((v) => ({
      rule_id: v.rule_id,
      rule_version_id: v.id,
      user_id: req.user.id,
      user_name_snapshot: req.user.name || "Resident",
      user_email_snapshot: req.user.email || "",
      society_id: targetSocietyId,
      source: sourceEnum,
      acknowledged_at: new Date(),
    }));

    await RuleAcknowledgement.bulkCreate(ackRecords, {
      ignoreDuplicates: true,
    });

    return res.status(200).json({
      message: "Rules acknowledged successfully",
      count: ackRecords.length,
    });
  } catch (err) {
    console.error("acknowledgeRules error:", err);
    return res.status(500).json({ message: "Failed to acknowledge rules" });
  }
};

/**
 * Authenticated (Super Admin / Society Admin / Committee): View rule acknowledgement audit report
 * GET /api/rules/:id/acknowledgements
 */
exports.getRuleAcknowledgements = async (req, res) => {
  try {
    const ruleId = parseSafePositiveInteger(req.params.id);
    if (!ruleId) return res.status(400).json({ message: "Invalid rule ID" });

    const rule = await Rule.findByPk(ruleId);
    if (!rule) return res.status(404).json({ message: "Rule not found" });

    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    if (!isSuperAdmin && String(rule.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Forbidden: cross-society access" });
    }

    // 1. Fetch current version of the rule
    const currentVersion = await RuleVersion.findOne({
      where: { rule_id: rule.id, is_current: true },
    });

    // 2. Fetch recorded acknowledgements for this rule
    const acknowledgements = await RuleAcknowledgement.findAll({
      where: { rule_id: rule.id },
      include: [
        {
          model: RuleVersion,
          as: "version",
          attributes: ["version_number", "document_name", "is_mandatory"],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "role", "resident_type"],
        },
      ],
      order: [["acknowledged_at", "DESC"]],
    });

    // Build map of acknowledgements by user_id
    const ackMapByUserId = new Map();
    for (const ack of acknowledgements) {
      if (!ackMapByUserId.has(ack.user_id)) {
        ackMapByUserId.set(ack.user_id, ack);
      } else if (currentVersion && ack.rule_version_id === currentVersion.id) {
        ackMapByUserId.set(ack.user_id, ack);
      }
    }

    // 3. Fetch all eligible residents in the society
    // Audience resolved from real society membership so multi-society residents are included
    let societyMemberIds = [];
    try {
      if (typeof getSocietyMemberUserIds === "function") {
        societyMemberIds = await getSocietyMemberUserIds(rule.society_id);
      }
    } catch (e) {
      console.warn("getSocietyMemberUserIds fallback:", e.message);
    }

    const eligibleResidents = await User.findAll({
      where: {
        status: "ACTIVE",
        [Op.or]: [
          { society_id: rule.society_id },
          ...(societyMemberIds.length > 0 ? [{ id: { [Op.in]: societyMemberIds } }] : []),
        ],
        [Op.and]: [
          {
            [Op.or]: [
              { role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER"] } },
              { resident_type: { [Op.in]: ["OWNER", "TENANT"] } },
            ],
          },
        ],
      },
      attributes: ["id", "name", "email", "phone", "role", "resident_type"],
      order: [["name", "ASC"]],
    });

    // 4. Collect all distinct user IDs that need society-scoped flat & role resolution
    const allUserIds = Array.from(new Set([
      ...eligibleResidents.map((r) => r.id),
      ...acknowledgements.map((a) => a.user_id),
    ])).filter(Boolean);

    // Query active FlatMemberships strictly belonging to rule.society_id
    const activeMemberships = allUserIds.length > 0
      ? await FlatMembership.findAll({
          where: {
            user_id: { [Op.in]: allUserIds },
            is_current: true,
          },
          include: [
            {
              model: Flat,
              attributes: ["id", "flat_number", "block_id", "floor_id"],
              required: true,
              include: [
                {
                  model: Block,
                  attributes: ["id", "name", "society_id"],
                  where: { society_id: rule.society_id },
                  required: true,
                },
              ],
            },
          ],
          order: [["updatedAt", "DESC"], ["id", "DESC"]],
        })
      : [];

    // Query HouseholdMembers (family members) strictly in rule.society_id
    const householdMembers = allUserIds.length > 0
      ? await HouseHoldMember.findAll({
          where: { user_id: { [Op.in]: allUserIds } },
          attributes: ["id", "user_id", "flat_id"],
          include: [
            {
              model: Flat,
              attributes: ["id", "flat_number", "block_id"],
              required: true,
              include: [
                {
                  model: Block,
                  attributes: ["id", "name", "society_id"],
                  where: { society_id: rule.society_id },
                  required: true,
                },
              ],
            },
          ],
        })
      : [];

    // Query direct flats (fallback for direct assignment via Flat.resident_id)
    const directFlats = allUserIds.length > 0
      ? await Flat.findAll({
          where: {
            resident_id: { [Op.in]: allUserIds },
          },
          attributes: ["id", "flat_number", "resident_id", "block_id"],
          include: [
            {
              model: Block,
              attributes: ["id", "name", "society_id"],
              where: { society_id: rule.society_id },
              required: true,
            },
          ],
        })
      : [];

    // Query UserSociety memberships for this society
    const userSocieties = allUserIds.length > 0
      ? await UserSociety.findAll({
          where: {
            user_id: { [Op.in]: allUserIds },
            society_id: rule.society_id,
          },
          attributes: ["id", "user_id", "resident_type", "roles"],
        })
      : [];

    // Build society-specific flat and role maps
    const userFlatMap = new Map();
    const userRoleTypeMap = new Map();

    for (const m of activeMemberships) {
      if (!userFlatMap.has(m.user_id)) {
        userFlatMap.set(m.user_id, new Set());
      }
      if (m.Flat?.flat_number) {
        userFlatMap.get(m.user_id).add(m.Flat.flat_number);
      }
      if (m.role && !userRoleTypeMap.has(m.user_id)) {
        userRoleTypeMap.set(m.user_id, m.role);
      }
    }

    for (const h of householdMembers) {
      if (!userFlatMap.has(h.user_id)) {
        userFlatMap.set(h.user_id, new Set());
      }
      if (h.Flat?.flat_number) {
        userFlatMap.get(h.user_id).add(h.Flat.flat_number);
      }
      if (!userRoleTypeMap.has(h.user_id)) {
        userRoleTypeMap.set(h.user_id, "FAMILY_MEMBER");
      }
    }

    for (const df of directFlats) {
      if (!userFlatMap.has(df.resident_id)) {
        userFlatMap.set(df.resident_id, new Set());
      }
      if (df.flat_number) {
        userFlatMap.get(df.resident_id).add(df.flat_number);
      }
      if (!userRoleTypeMap.has(df.resident_id)) {
        userRoleTypeMap.set(df.resident_id, "OWNER");
      }
    }

    const userSocietyMap = new Map();
    for (const us of userSocieties) {
      userSocietyMap.set(us.user_id, us);
    }

    const resolveResidentInfo = (userObj) => {
      const flatsSet = userFlatMap.get(userObj.id);
      const flatNum = flatsSet && flatsSet.size > 0 ? Array.from(flatsSet).join(", ") : null;

      const effectiveType =
        userRoleTypeMap.get(userObj.id) ||
        (userObj.resident_type && userObj.resident_type !== "RESIDENT" ? userObj.resident_type : null) ||
        userSocietyMap.get(userObj.id)?.resident_type ||
        (userObj.role === "RESIDENT" ? "OWNER" : userObj.role) ||
        "OWNER";

      return { flatNum, effectiveType };
    };

    // 5. Combine eligible residents with acknowledgement status
    const records = [];
    const seenUserIds = new Set();

    for (const resident of eligibleResidents) {
      seenUserIds.add(resident.id);
      const ack = ackMapByUserId.get(resident.id);
      const { flatNum, effectiveType } = resolveResidentInfo(resident);

      records.push({
        user_id: resident.id,
        user_name: resident.name,
        user_email: resident.email,
        phone: resident.phone,
        role: resident.role,
        resident_type: effectiveType,
        flat_number: flatNum,
        status: ack ? "ACKNOWLEDGED" : "PENDING",
        acknowledged_at: ack ? ack.acknowledged_at : null,
        rule_version_id: ack ? ack.rule_version_id : null,
        version_number: ack?.version ? ack.version.version_number : null,
        is_current_version: currentVersion && ack ? ack.rule_version_id === currentVersion.id : Boolean(ack),
        source: ack ? ack.source : null,
      });
    }

    // Add any external acknowledgement that might belong to a resident not in eligible query
    for (const ack of acknowledgements) {
      if (!seenUserIds.has(ack.user_id)) {
        seenUserIds.add(ack.user_id);
        const userObj = ack.user || {
          id: ack.user_id,
          name: ack.user_name_snapshot,
          email: ack.user_email_snapshot,
          phone: null,
          role: "RESIDENT",
          resident_type: "OWNER",
        };
        const { flatNum, effectiveType } = resolveResidentInfo(userObj);

        records.push({
          user_id: ack.user_id,
          user_name: ack.user ? ack.user.name : ack.user_name_snapshot,
          user_email: ack.user ? ack.user.email : ack.user_email_snapshot,
          phone: ack.user ? ack.user.phone : null,
          role: ack.user ? ack.user.role : "RESIDENT",
          resident_type: effectiveType,
          flat_number: flatNum,
          status: "ACKNOWLEDGED",
          acknowledged_at: ack.acknowledged_at,
          rule_version_id: ack.rule_version_id,
          version_number: ack.version ? ack.version.version_number : null,
          is_current_version: currentVersion ? ack.rule_version_id === currentVersion.id : true,
          source: ack.source,
        });
      }
    }

    // Summary calculation
    const totalEligible = records.length;
    const totalAcknowledged = records.filter((r) => r.status === "ACKNOWLEDGED").length;
    const totalPending = totalEligible - totalAcknowledged;
    const acknowledgementRate =
      totalEligible > 0 ? Math.round((totalAcknowledged / totalEligible) * 100) : 0;

    return res.status(200).json({
      rule: {
        id: rule.id,
        title: rule.title,
        category: rule.category,
        is_mandatory: rule.is_mandatory,
        current_version_number: currentVersion ? currentVersion.version_number : null,
      },
      summary: {
        total_eligible: totalEligible,
        total_acknowledged: totalAcknowledged,
        total_pending: totalPending,
        acknowledgement_rate: acknowledgementRate,
      },
      records,
      acknowledgements: acknowledgements.map((a) => ({
        id: a.id,
        rule_version_id: a.rule_version_id,
        version_number: a.version ? a.version.version_number : null,
        user_id: a.user_id,
        user_name: a.user ? a.user.name : a.user_name_snapshot,
        user_email: a.user ? a.user.email : a.user_email_snapshot,
        phone: a.user ? a.user.phone : null,
        source: a.source,
        acknowledged_at: a.acknowledged_at,
      })),
    });
  } catch (err) {
    console.error("getRuleAcknowledgements error:", err);
    return res.status(500).json({ message: "Failed to fetch acknowledgements" });
  }
};

/**
 * Helper: Notify residents about newly published rule or new version
 */
async function notifyRuleEvent(societyId, publisherId, rule, version, isMandatory, isNew) {
  try {
    const residents = await User.findAll({
      where: {
        society_id: societyId,
        status: "ACTIVE",
        role: { [Op.in]: ["RESIDENT", "FAMILY_MEMBER"] },
      },
      attributes: ["id", "fcm_token"],
    });

    for (const resident of residents) {
      notificationService
        .sendNotification({
          societyId,
          receiverUserId: resident.id,
          senderUserId: publisherId,
          receiverRole: "RESIDENT",
          title: isMandatory ? "⚠️ Mandatory Society Rule Update" : "📋 Society Rule Update",
          message: isMandatory
            ? `Rule "${rule.title}" (v${version.version_number}) has been published and requires your acknowledgement.`
            : `Rule "${rule.title}" (v${version.version_number}) has been updated.`,
          type: "RULE_UPDATE",
          actionType: "VIEW_RULES",
          actionRoute: "/resident/rules",
          fcmToken: resident.fcm_token,
          sourceEventId: `RULE:${rule.id}:v${version.version_number}:${resident.id}`,
          extraData: {
            route: "/resident/rules",
            ruleId: rule.id.toString(),
            versionId: version.id.toString(),
          },
        })
        .catch((e) => console.warn("Rule notification error:", e.message));
    }
  } catch (err) {
    console.warn("notifyRuleEvent error:", err.message);
  }
}

