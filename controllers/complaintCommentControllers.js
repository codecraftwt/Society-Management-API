
const ComplaintComment = require("../models/ComplaintComment");
const Complaint        = require("../models/Complaint");
const User             = require("../models/User");
const cloudinary       = require("../config/cloudinary");
const { Readable }     = require("stream");
const ComplaintReadStatus = require("../models/ComplaintReadStatus");
const { Op } = require("sequelize");
const IMAGE_MIME = /^image\//;

/* Upload buffer to Cloudinary as a PUBLICLY accessible raw file */
const uploadRawBuffer = (buffer, filename) => {
  return new Promise((resolve, reject) => {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const publicId  = `complaint_comments/files/${Date.now()}-${sanitized}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id:     publicId,
        type:          "upload",
        access_mode:   "public",
        overwrite:     true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

/* ═══════════════════════════════════════
   GET COMMENTS
═══════════════════════════════════════ */
const getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    const where = { id };
    if (!isSuperAdmin) {
      where.society_id = req.user.society_id;
    }

    const complaint = await Complaint.findOne({ where });
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    const comments = await ComplaintComment.findAll({
      where:   { complaint_id: id },
      include: [{ model: User, attributes: ["id", "name", "role", "roles"] }],
      order:   [["created_at", "ASC"]],
    });
    res.json(comments);
  } catch (err) {
    console.error("[getComments]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════
   POST COMMENT
═══════════════════════════════════════ */
const postComment = async (req, res) => {
  try {
    const { id }      = req.params;
    const { message } = req.body;
    const file        = req.file;

    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    if (!message?.trim() && !file) {
      return res.status(400).json({ message: "Message or attachment is required" });
    }

    const where = { id };
    if (!isSuperAdmin) {
      where.society_id = req.user.society_id;
    }

    const complaint = await Complaint.findOne({ where });
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    if (!isSuperAdmin && (req.user.role === "RESIDENT" || req.user.role === "FAMILY_MEMBER")) {
      if (complaint.resident_id !== req.user.id) {
        return res.status(403).json({ message: "Not your complaint" });
      }
    }

    let attachment_url  = null;
    let attachment_type = null;
    let attachment_name = null;

    if (file) {
      attachment_name = file.originalname;

      if (IMAGE_MIME.test(file.mimetype)) {
        // Image — multer-storage-cloudinary already uploaded it
        attachment_url  = file.path;
        attachment_type = "image";
      } else {
        // Raw file — upload manually
        const result    = await uploadRawBuffer(file.buffer, file.originalname);
        attachment_url  = result.secure_url;
        attachment_type = "file";
      }
    }

    const comment = await ComplaintComment.create({
      complaint_id: id,
      user_id:      req.user.id,
      message:      message?.trim() || null,
      attachment_url,
      attachment_type,
      attachment_name,
    });

    const full = await ComplaintComment.findByPk(comment.id, {
      include: [{ model: User, attributes: ["id", "name", "role", "roles"] }],
    });

    if (global.io) {
      // ✅ Emit to the SOCIETY room so every online member gets it,
      // regardless of whether they've joined the specific complaint room.
      // This fixes the "first message badge never shows" bug.
      // The complaint room emit is kept for ChatPanel live-append to work.
      global.io
        .to(`complaint_${id}`)
        .to(`society_${complaint.society_id}`)
        .emit("new_complaint_comment", full);
    }

    res.status(201).json(full);
  } catch (err) {
    console.error("[postComment]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════
   DELETE COMMENT
═══════════════════════════════════════ */
const deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    const where = { id };
    if (!isSuperAdmin) {
      where.society_id = req.user.society_id;
    }

    const complaint = await Complaint.findOne({ where });
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    const comment = await ComplaintComment.findOne({
      where: { id: commentId, complaint_id: id },
    });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const isAdmin = ["SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"].includes(activeRole);
    const isOwner = comment.user_id === req.user.id;
    if (!isAdmin && !isOwner) return res.status(403).json({ message: "Not authorized" });

    await comment.destroy();

    if (global.io) {
      global.io.to(`complaint_${id}`).emit("complaint_comment_deleted", {
        complaint_id: id,
        comment_id:   commentId,
      });
    }
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("[deleteComment]", err);
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════
   CLEAR ALL COMMENTS
═══════════════════════════════════════ */
const clearComments = async (req, res) => {
  try {
    const { id } = req.params;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    const where = { id };
    if (!isSuperAdmin) {
      where.society_id = req.user.society_id;
    }

    const complaint = await Complaint.findOne({ where });
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    const isAdmin = ["SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"].includes(activeRole);
    const isOwner = complaint.resident_id === req.user.id;
    if (!isAdmin && !isOwner) return res.status(403).json({ message: "Not authorized" });

    await ComplaintComment.destroy({ where: { complaint_id: id } });

    if (global.io) {
      global.io.to(`complaint_${id}`).emit("complaint_comments_cleared", { complaint_id: id });
    }
    res.json({ message: "Cleared" });
  } catch (err) {
    console.error("[clearComments]", err);
    res.status(500).json({ message: err.message });
  }
};


/* ═══════════════════════════════════════
   MARK COMPLAINT AS READ
═══════════════════════════════════════ */
const markComplaintRead = async (req, res) => {
  try {
    const { id } = req.params;

    await ComplaintReadStatus.upsert({
      complaint_id: id,
      user_id: req.user.id,
      last_read_at: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[markComplaintRead]", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getComments, postComment, deleteComment, clearComments, markComplaintRead };