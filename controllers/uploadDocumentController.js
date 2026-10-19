const UserDocuments = require("../models/UserDocuments");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const { Op } = require("sequelize");

const verifyUserAccess = async (req, targetUserId) => {
  const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
  if (isSuperAdmin) return true;

  if (targetUserId === req.user.id) return true;

  const isSocietyAdmin = req.user.role === "SOCIETY_ADMIN" || req.user.activeRole === "SOCIETY_ADMIN";
  const isCommittee = req.user.role === "COMMITTEE_MEMBER" || req.user.activeRole === "COMMITTEE_MEMBER";
  const isAccountant = req.user.role === "ACCOUNTANT" || req.user.activeRole === "ACCOUNTANT";

  if (isSocietyAdmin || isCommittee || isAccountant) {
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) return false;
    if (String(targetUser.society_id) === String(req.user.society_id)) return true;

    const membership = await UserSociety.findOne({
      where: {
        user_id: targetUserId,
        society_id: req.user.society_id,
        membership_status: { [Op.ne]: "REJECTED" },
      },
    });
    return Boolean(membership);
  }

  return false;
};

const uploadDocumentsController = async (req, res) => {
  try {
    let userId = req.user.id;

    if (req.query.userId) {
      const targetUserId = parseInt(req.query.userId, 10);
      if (targetUserId && targetUserId !== req.user.id) {
        const allowed = await verifyUserAccess(req, targetUserId);
        if (!allowed) {
          return res.status(403).json({ message: "Cannot upload documents for a user outside your society" });
        }
        userId = targetUserId;
      }
    }

    const aadhar = req.files?.aadhar?.[0];
    const pan    = req.files?.pan?.[0];

    const existing = await UserDocuments.findOne({ where: { user_id: userId } });

    if (!existing && (!aadhar || !pan)) {
      return res.status(400).json({ message: "Both documents required" });
    }

    if (existing && !aadhar && !pan) {
      return res.status(400).json({ message: "At least one document (Aadhaar or PAN) is required to update" });
    }

    if (existing) {
      const updateData = {};
      if (aadhar) {
        updateData.aadhar_url = aadhar.path;
        updateData.aadhar_public_id = aadhar.filename;
      }
      if (pan) {
        updateData.pan_url = pan.path;
        updateData.pan_public_id = pan.filename;
      }
      await existing.update(updateData);
      return res.json({ message: "Documents updated successfully", documents: existing });
    }

    const newDocs = await UserDocuments.create({
      user_id:          userId,
      aadhar_url:       aadhar.path,
      aadhar_public_id: aadhar.filename,
      pan_url:          pan.path,
      pan_public_id:    pan.filename,
    });

    res.json({ message: "Documents uploaded successfully", documents: newDocs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getUserDocumentsController = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId, 10);
    if (!targetUserId) {
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    const allowed = await verifyUserAccess(req, targetUserId);
    if (!allowed) {
      return res.status(403).json({ message: "Access denied" });
    }

    const docs = await UserDocuments.findOne({ where: { user_id: targetUserId } });
    return res.json(docs || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateDocumentController = async (req, res) => {
  try {
    let userId = req.user.id;
    if (req.query.userId) {
      const targetUserId = parseInt(req.query.userId, 10);
      if (targetUserId && targetUserId !== req.user.id) {
        const allowed = await verifyUserAccess(req, targetUserId);
        if (!allowed) {
          return res.status(403).json({ message: "Cannot update documents for a user outside your society" });
        }
        userId = targetUserId;
      }
    }

    const { type } = req.params; // "aadhar" | "pan"

    // Only accept the file matching the type in the URL
    const uploadedFile = req.files?.[type]?.[0];

    if (!uploadedFile) {
      return res.status(400).json({
        message: `No file provided. Send a single '${type}' file only.`,
      });
    }

    // Block if someone sneaks in both fields
    const otherType = type === "aadhar" ? "pan" : "aadhar";
    if (req.files?.[otherType]?.[0]) {
      return res.status(400).json({
        message: `Only one document can be updated at a time. Remove the '${otherType}' file.`,
      });
    }

    // Must have an existing record — cannot create via this route
    const existing = await UserDocuments.findOne({ where: { user_id: userId } });
    if (!existing) {
      return res.status(404).json({
        message: "No document record found. Please do the initial upload first.",
      });
    }

    // Update only the matching field
    await existing.update({
      [`${type}_url`]:       uploadedFile.path,
      [`${type}_public_id`]: uploadedFile.filename,
    });

    res.json({
      message: `${type.toUpperCase()} updated successfully`,
      [`${type}_url`]: uploadedFile.path,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteDocumentController = async (req, res) => {
  try {
    let userId = req.user.id;
    if (req.query.userId) {
      const targetUserId = parseInt(req.query.userId, 10);
      if (targetUserId && targetUserId !== req.user.id) {
        const allowed = await verifyUserAccess(req, targetUserId);
        if (!allowed) {
          return res.status(403).json({ message: "Cannot delete documents for a user outside your society" });
        }
        userId = targetUserId;
      }
    }

    const { type } = req.params; // "aadhar" | "pan"

    if (!["aadhar", "pan"].includes(type)) {
      return res.status(400).json({
        message: "Invalid document type. Use 'aadhar' or 'pan'",
      });
    }

    // Must have an existing record
    const existing = await UserDocuments.findOne({ where: { user_id: userId } });
    if (!existing) {
      return res.status(404).json({
        message: "No document record found.",
      });
    }

    // Check the specific doc exists
    if (!existing[`${type}_url`]) {
      return res.status(404).json({
        message: `No ${type.toUpperCase()} document found to delete.`,
      });
    }

    // Check if deleting this will leave the record completely empty
    const otherType = type === "aadhar" ? "pan" : "aadhar";
    const otherExists = !!existing[`${otherType}_url`];

    if (!otherExists) {
      // Both will be gone — delete the whole record
      await existing.destroy();
      return res.json({
        message: `${type.toUpperCase()} deleted. No remaining documents, record removed.`,
      });
    }

    // Otherwise just null out this field only
    await existing.update({
      [`${type}_url`]:       null,
      [`${type}_public_id`]: null,
    });

    res.json({
      message: `${type.toUpperCase()} deleted successfully`,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  uploadDocumentsController,
  getUserDocumentsController,
  updateDocumentController,
  deleteDocumentController,
};