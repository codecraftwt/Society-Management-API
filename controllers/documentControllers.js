const path = require("path");
const fs   = require("fs");
const { Op } = require("sequelize");
const { Document, User, Flat, Block, Notification } = require("../models");

/* ════════════════════════════════════════
   HELPER: bytes → "2.4 MB"
════════════════════════════════════════ */
const formatSize = (bytes) => {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/* ════════════════════════════════════════
   HELPER: visible_to filter by role
════════════════════════════════════════ */
const visibilityFilter = (role) => {
  if (role === "RESIDENT")
    return { visible_to: { [Op.in]: ["ALL_RESIDENTS", "FLAT_OWNERS_ONLY"] } };
  if (role === "FAMILY_MEMBER")
    return { visible_to: "ALL_RESIDENTS" };
  return {};
};

/* ════════════════════════════════════════
   RESIDENT
   GET /api/documents  ← PAGINATION + SEARCH + FILTER
════════════════════════════════════════ */
const getDocuments = async (req, res) => {
  try {
    const user = req.user;

    if (user.status !== "ACTIVE") {
      return res.status(403).json({ message: "Your account is inactive" });
    }
    if (user.role === "GUARD") {
      return res.status(403).json({ message: "Access denied" });
    }
    if (!user.society_id) {
      return res.status(403).json({ message: "You are not assigned to any society" });
    }

    const residentRoles = ["RESIDENT", "FAMILY_MEMBER"];

    if (residentRoles.includes(user.role)) {
      const flat = await Flat.findOne({
        where: { resident_id: user.id },
        include: [
          {
            model: Block,
            where: { society_id: user.society_id },
            required: true,
            attributes: [],
          },
        ],
        attributes: ["id"],
      });

      if (!flat) {
        return res.status(403).json({
          message: "Access denied. You must be assigned to a flat to view documents.",
        });
      }
    }

    // ── Pagination ──
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 12);
    const offset = (page - 1) * limit;

    // ── Search ──
    const search = req.query.search?.trim() || "";

    // ── Category filter ──
    const category = req.query.category || "All";

    // ── Build WHERE ──
    const where = {
      society_id: user.society_id,
      is_active:  true, // ✅ Already correct
      ...visibilityFilter(user.role),
    };

    if (category && category !== "All") {
      where.category = category;
    }

    if (search) {
      where[Op.or] = [
        { title:       { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { category:    { [Op.like]: `%${search}%` } },
      ];
    }

    // ── Main paginated query ──
    const { count, rows } = await Document.findAndCountAll({
      where,
      include: [{ model: User, as: "uploader", attributes: ["id", "name"] }],
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const data = rows.map((d) => ({
      ...d.toJSON(),
      file_size_formatted: formatSize(d.file_size),
    }));

    // ── Category counts ──
    const visFilter = visibilityFilter(user.role);
    const baseWhere = { society_id: user.society_id, is_active: true, ...visFilter };

    const [totalAll, totalLegal, totalMeetings, totalGuidelines, totalFinance, totalSecurity] =
      await Promise.all([
        Document.count({ where: baseWhere }),
        Document.count({ where: { ...baseWhere, category: "Legal"      } }),
        Document.count({ where: { ...baseWhere, category: "Meetings"   } }),
        Document.count({ where: { ...baseWhere, category: "Guidelines" } }),
        Document.count({ where: { ...baseWhere, category: "Finance"    } }),
        Document.count({ where: { ...baseWhere, category: "Security"   } }),
      ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        All:        totalAll,
        Legal:      totalLegal,
        Meetings:   totalMeetings,
        Guidelines: totalGuidelines,
        Finance:    totalFinance,
        Security:   totalSecurity,
      },
    });

  } catch (err) {
    console.error("[getDocuments]", err);
    return res.status(500).json({ message: "Failed to fetch documents" });
  }
};


/* ════════════════════════════════════════
   ADMIN
   GET /api/documents/admin
════════════════════════════════════════ */
/* ════════════════════════════════════════
   ADMIN
   GET /api/documents/admin  ← PAGINATION + SEARCH + CATEGORY FILTER
   Drop-in replacement for adminGetDocuments in documentController.js
   All other functions unchanged.
════════════════════════════════════════ */
const adminGetDocuments = async (req, res) => {
  try {
    // ── Pagination ──
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // ── Search ──
    const search   = req.query.search?.trim()   || "";
    const category = req.query.category?.trim() || "All";

    // ── Base WHERE ──
    const where = { society_id: req.user.society_id };

    if (category && category !== "All") {
      where.category = category;
    }

    if (search) {
      where[Op.or] = [
        { title:       { [Op.like]: `%${search}%` } },
        { category:    { [Op.like]: `%${search}%` } },
        { file_name:   { [Op.like]: `%${search}%` } },
      ];
    }

    // ── Paginated query ──
    const { count, rows } = await Document.findAndCountAll({
      where,
      include: [{ model: User, as: "uploader", attributes: ["id", "name"] }],
      order:   [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    const data = rows.map(d => ({
      ...d.toJSON(),
      file_size_formatted: formatSize(d.file_size),
    }));

    // ── Category counts (always society-scoped, unaffected by search/filter) ──
    const base = { society_id: req.user.society_id };
    const [totalAll, totalLegal, totalMeetings, totalGuidelines, totalFinance, totalSecurity] =
      await Promise.all([
        Document.count({ where: base }),
        Document.count({ where: { ...base, category: "Legal"      } }),
        Document.count({ where: { ...base, category: "Meetings"   } }),
        Document.count({ where: { ...base, category: "Guidelines" } }),
        Document.count({ where: { ...base, category: "Finance"    } }),
        Document.count({ where: { ...base, category: "Security"   } }),
      ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        All:        totalAll,
        Legal:      totalLegal,
        Meetings:   totalMeetings,
        Guidelines: totalGuidelines,
        Finance:    totalFinance,
        Security:   totalSecurity,
      },
    });
  } catch (err) {
    console.error("[adminGetDocuments]", err);
    return res.status(500).json({ message: "Failed to fetch documents" });
  }
};


/* ════════════════════════════════════════
   ADMIN
   POST /api/documents/admin
════════════════════════════════════════ */
const adminUploadDocument = async (req, res) => {
  try {
    const { title, description, category, visible_to } = req.body;
    const uploadedFile = req.file;

    if (!title || !category) {
      return res.status(400).json({ message: "Title and category are required" });
    }
    if (!uploadedFile) {
      return res.status(400).json({ message: "Please upload a file" });
    }

    const doc = await Document.create({
      title:       title.trim(),
      description: description?.trim() || null,
      category,
      file_name:   uploadedFile.originalname,
      file_url:    uploadedFile.path,
      file_size:   uploadedFile.size,
      mime_type:   uploadedFile.mimetype,
      society_id:  req.user.society_id,
      uploaded_by: req.user.id,
      visible_to:  visible_to || "ALL_RESIDENTS",
      is_active:   true,
    });

    /* ── Notify Residents ── */
    const flats = await Flat.findAll({
      include: [
        {
          model: Block,
          where: { society_id: req.user.society_id },
          attributes: [],
          required: true,
        },
      ],
      attributes: ["resident_id"],
    });

    const residentIds = flats.map((f) => f.resident_id).filter(Boolean);

    if (residentIds.length > 0) {
      const notifications = residentIds.map((id) => ({
        title:            "New Document Uploaded",
        message:          `${title} has been uploaded`,
        type:             "DOCUMENT",
        society_id:       req.user.society_id,
        user_id:          id,
        receiver_user_id: id,
      }));

      await Notification.bulkCreate(notifications);
    }

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      data: { ...doc.toJSON(), file_size_formatted: formatSize(doc.file_size) },
    });
  } catch (err) {
    console.error("[adminUploadDocument]", err);
    return res.status(500).json({ message: "Upload failed" });
  }
};


/* ════════════════════════════════════════
   ADMIN
   PATCH /api/documents/admin/:id
════════════════════════════════════════ */
const adminUpdateDocument = async (req, res) => {
  try {
    const doc = await Document.findOne({
      where: { id: req.params.id, society_id: req.user.society_id },
    });

    if (!doc) return res.status(404).json({ message: "Document not found" });

    const { title, description, category, visible_to, is_active } = req.body;

    await doc.update({
      ...(title       !== undefined && { title: title.trim()              }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(category    !== undefined && { category                         }),
      ...(visible_to  !== undefined && { visible_to                       }),
      ...(is_active   !== undefined && { is_active                        }),
    });

    return res.status(200).json({ success: true, message: "Document updated", data: doc });
  } catch (err) {
    console.error("[adminUpdateDocument]", err);
    return res.status(500).json({ message: "Update failed" });
  }
};


/* ════════════════════════════════════════
   ADMIN
   DELETE /api/documents/admin/:id
════════════════════════════════════════ */
const adminDeleteDocument = async (req, res) => {
  try {
    const doc = await Document.findOne({
      where: { id: req.params.id, society_id: req.user.society_id },
    });

    if (!doc) return res.status(404).json({ message: "Document not found" });

    if (req.query.hard === "true") {
      if (doc.file_url && !doc.file_url.startsWith("http")) {
        const filePath = path.resolve(doc.file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      await doc.destroy();
      return res.status(200).json({ success: true, message: "Document permanently deleted" });
    }

    await doc.update({ is_active: false });

    return res.status(200).json({ success: true, message: "Document removed from resident view" });
  } catch (err) {
    console.error("[adminDeleteDocument]", err);
    return res.status(500).json({ message: "Delete failed" });
  }
};


module.exports = {
  getDocuments,
  adminGetDocuments,
  adminUploadDocument,
  adminUpdateDocument,
  adminDeleteDocument,
};