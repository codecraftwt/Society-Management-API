const {
  AmenityRule,
  AmenityRuleAttachment,
  AmenityBookingTermsAcceptance,
  AmenityBooking,
  User,
  sequelize,
} = require("../models");
const crypto = require("crypto");
const { Op } = require("sequelize");

function getTargetSocietyId(req) {
  const isSuperAdmin =
    req.user?.activeRole === "SUPER_ADMIN" ||
    (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

  if (isSuperAdmin) {
    const raw =
      req.body?.society_id ||
      req.query.societyId ||
      req.query.society_id ||
      req.headers["x-society-id"];
    if (raw && raw !== "ALL") {
      const num = Number(raw);
      if (Number.isSafeInteger(num) && num > 0) return num;
    }
  }

  return req.user?.society_id ? Number(req.user.society_id) : null;
}

function computeRulesetVersion(rules) {
  if (!rules || rules.length === 0) return null;
  const raw = rules
    .map((r) => `${r.id}:${new Date(r.updated_at).getTime()}`)
    .join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function normalizeRuleType(val) {
  if (!val) return "TEXT";
  const s = val.toString().trim().toUpperCase();
  if (s === "IMG" || s === "IMAGE") return "IMAGE";
  if (s === "PDF") return "PDF";
  return "TEXT";
}

/* ═══════════════════════════════════════
   CREATE AMENITY RULE (Management)
   POST /api/admin/amenities/rules
═══════════════════════════════════════ */
exports.createRule = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const societyId = getTargetSocietyId(req);
    if (!societyId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Valid society context is required." });
    }

    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const ruleType = normalizeRuleType(req.body.rule_type || req.body.upload_type);
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    const formattedContent = req.body.formatted_content || null;
    const isMandatory = req.body.is_mandatory !== false && req.body.is_mandatory !== "false";

    if (!title) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Rule title is required." });
    }

    const files = req.files && Array.isArray(req.files) ? req.files : [];

    // Type-specific validations
    if (ruleType === "TEXT") {
      if (!content && !formattedContent) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Rule content/summary is required for text rules.",
        });
      }
    } else if (ruleType === "IMAGE") {
      if (files.length === 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Please upload at least one image policy file (JPG, PNG, WEBP).",
        });
      }
    } else if (ruleType === "PDF") {
      if (files.length === 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Please upload at least one PDF policy document.",
        });
      }
    }

    const rule = await AmenityRule.create(
      {
        society_id: societyId,
        title,
        rule_type: ruleType,
        content: content || null,
        formatted_content: formattedContent,
        is_mandatory: isMandatory,
        is_active: true,
        created_by_user_id: req.user.id,
      },
      { transaction: t }
    );

    // Handle uploaded attachments from Multer / Cloudinary
    if (files.length > 0) {
      const attachmentRecords = files.map((f) => {
        const isPdf =
          (f.mimetype || "").toLowerCase().includes("pdf") ||
          (f.originalname || "").toLowerCase().endsWith(".pdf");
        return {
          rule_id: rule.id,
          file_name: f.originalname || "attachment",
          file_url: f.path,
          file_type: isPdf ? "PDF" : "IMAGE",
          file_size: f.size || null,
        };
      });
      await AmenityRuleAttachment.bulkCreate(attachmentRecords, { transaction: t });
    }

    await t.commit();

    const created = await AmenityRule.findByPk(rule.id, {
      include: [
        { model: AmenityRuleAttachment, as: "attachments" },
        { model: User, as: "creator", attributes: ["id", "name", "role"] },
      ],
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    await t.rollback();
    console.error("[amenityRules.createRule]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to create amenity rule." });
  }
};

/* ═══════════════════════════════════════
   LIST ALL AMENITY RULES (Management)
   GET /api/admin/amenities/rules
═══════════════════════════════════════ */
exports.getAllRules = async (req, res) => {
  try {
    const societyId = getTargetSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Valid society context is required." });
    }

    const rules = await AmenityRule.findAll({
      where: { society_id: societyId },
      include: [
        { model: AmenityRuleAttachment, as: "attachments" },
        { model: User, as: "creator", attributes: ["id", "name", "role"] },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({ success: true, data: rules });
  } catch (err) {
    console.error("[amenityRules.getAllRules]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch amenity rules." });
  }
};

/* ═══════════════════════════════════════
   GET PUBLISHED AMENITY RULES (Resident)
   GET /api/amenities/rules/published
═══════════════════════════════════════ */
exports.getPublishedRules = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) {
      return res.status(400).json({ success: false, message: "User is not assigned to a society." });
    }

    const rules = await AmenityRule.findAll({
      where: {
        society_id: societyId,
        is_active: true,
      },
      include: [
        { model: AmenityRuleAttachment, as: "attachments" },
      ],
      order: [["created_at", "ASC"]],
    });

    const hasRules = rules.length > 0;
    const rulesetVersion = hasRules ? computeRulesetVersion(rules) : null;

    return res.json({
      success: true,
      has_rules: hasRules,
      ruleset_version: rulesetVersion,
      rules,
    });
  } catch (err) {
    console.error("[amenityRules.getPublishedRules]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch published rules." });
  }
};

/* ═══════════════════════════════════════
   UPDATE AMENITY RULE (Management)
   PUT /api/admin/amenities/rules/:id
═══════════════════════════════════════ */
exports.updateRule = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const societyId = getTargetSocietyId(req);

    const rule = await AmenityRule.findOne({
      where: { id, society_id: societyId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!rule) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Amenity rule not found." });
    }

    const updateFields = {};
    if (typeof req.body.title === "string" && req.body.title.trim()) {
      updateFields.title = req.body.title.trim();
    }
    if (req.body.rule_type !== undefined || req.body.upload_type !== undefined) {
      updateFields.rule_type = normalizeRuleType(req.body.rule_type || req.body.upload_type);
    }
    if (req.body.content !== undefined) {
      updateFields.content = typeof req.body.content === "string" && req.body.content.trim() ? req.body.content.trim() : null;
    }
    if (req.body.formatted_content !== undefined) {
      updateFields.formatted_content = typeof req.body.formatted_content === "string" && req.body.formatted_content.trim() ? req.body.formatted_content.trim() : null;
    }
    if (req.body.is_mandatory !== undefined) {
      updateFields.is_mandatory = req.body.is_mandatory !== false && req.body.is_mandatory !== "false";
    }
    if (req.body.is_active !== undefined) {
      updateFields.is_active = req.body.is_active !== false && req.body.is_active !== "false";
    }

    // When changing from TEXT to non-TEXT (IMAGE or PDF), clear formatted_content
    const effectiveRuleType = updateFields.rule_type || rule.rule_type;
    if (effectiveRuleType !== "TEXT") {
      updateFields.formatted_content = null;
    }

    await rule.update(updateFields, { transaction: t });

    // Handle removal of specific attachments if requested
    if (req.body.removed_attachment_ids) {
      let removeIds = [];
      try {
        removeIds = Array.isArray(req.body.removed_attachment_ids)
          ? req.body.removed_attachment_ids
          : JSON.parse(req.body.removed_attachment_ids);
      } catch (_) {
        removeIds = [Number(req.body.removed_attachment_ids)].filter(Boolean);
      }
      if (removeIds.length > 0) {
        await AmenityRuleAttachment.destroy({
          where: { id: { [Op.in]: removeIds }, rule_id: rule.id },
          transaction: t,
        });
      }
    }

    // Handle new attachments
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const newAttachments = req.files.map((f) => {
        const isPdf =
          (f.mimetype || "").toLowerCase().includes("pdf") ||
          (f.originalname || "").toLowerCase().endsWith(".pdf");
        return {
          rule_id: rule.id,
          file_name: f.originalname || "attachment",
          file_url: f.path,
          file_type: isPdf ? "PDF" : "IMAGE",
          file_size: f.size || null,
        };
      });
      await AmenityRuleAttachment.bulkCreate(newAttachments, { transaction: t });
    }

    await t.commit();

    const updated = await AmenityRule.findByPk(rule.id, {
      include: [
        { model: AmenityRuleAttachment, as: "attachments" },
        { model: User, as: "creator", attributes: ["id", "name", "role"] },
      ],
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    await t.rollback();
    console.error("[amenityRules.updateRule]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to update amenity rule." });
  }
};

/* ═══════════════════════════════════════
   DELETE AMENITY RULE (Management)
   DELETE /api/admin/amenities/rules/:id
═══════════════════════════════════════ */
exports.deleteRule = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = getTargetSocietyId(req);

    const rule = await AmenityRule.findOne({
      where: { id, society_id: societyId },
    });

    if (!rule) {
      return res.status(404).json({ success: false, message: "Amenity rule not found." });
    }

    // Soft delete preserves complete database integrity & history
    await rule.update({ is_active: false });

    return res.json({ success: true, message: "Amenity rule deactivated successfully." });
  } catch (err) {
    console.error("[amenityRules.deleteRule]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to delete amenity rule." });
  }
};

/* ═══════════════════════════════════════
   GET BOOKING ACCEPTED TERMS (Resident & Admin)
   GET /api/amenities/bookings/:id/accepted-terms
═══════════════════════════════════════ */
exports.getBookingAcceptedTerms = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await AmenityBooking.findByPk(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    // Verify society access & user authorization
    const isSuperAdmin =
      req.user?.activeRole === "SUPER_ADMIN" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("SUPER_ADMIN"));

    const isSocietyAdmin =
      req.user?.society_id === booking.society_id &&
      (req.user?.role === "SOCIETY_ADMIN" ||
        req.user?.activeRole === "SOCIETY_ADMIN" ||
        req.user?.role === "COMMITTEE_MEMBER" ||
        req.user?.activeRole === "COMMITTEE_MEMBER");

    const isBookingOwner = req.user.id === booking.user_id;

    if (!isSuperAdmin && !isSocietyAdmin && !isBookingOwner) {
      return res.status(403).json({ success: false, message: "You are not authorized to view this booking's terms." });
    }

    const acceptance = await AmenityBookingTermsAcceptance.findOne({
      where: { booking_id: bookingId },
    });

    if (!acceptance) {
      return res.json({
        success: true,
        has_accepted_terms: false,
        data: {
          booking: {
            id: booking.id,
            terms_accepted: Boolean(booking.terms_accepted),
            terms_accepted_at: booking.terms_accepted_at,
          },
          acceptance: null,
        },
        message: "No terms acceptance was required or recorded for this booking.",
      });
    }

    return res.json({
      success: true,
      has_accepted_terms: true,
      data: {
        ...(acceptance.toJSON ? acceptance.toJSON() : acceptance),
        booking: {
          id: booking.id,
          terms_accepted: Boolean(booking.terms_accepted),
          terms_accepted_at: booking.terms_accepted_at,
        },
        acceptance,
      },
    });
  } catch (err) {
    console.error("[amenityRules.getBookingAcceptedTerms]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to load accepted terms." });
  }
};

module.exports.computeRulesetVersion = computeRulesetVersion;
