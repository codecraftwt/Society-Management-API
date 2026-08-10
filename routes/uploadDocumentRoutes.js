const express = require("express");
const router  = express.Router();

const auth   = require("../middlewares/authMiddleware");
const role   = require("../middlewares/roleMiddleware");
const uploadUserDocument = require("../middlewares/uploadUserDocuments"); // ✅ NEW

const { uploadDocumentsController,updateDocumentController ,deleteDocumentController} = require("../controllers/uploadDocumentController");

// POST /api/user-documents — upload Aadhar + PAN
router.post(
  "/",
  auth,
  role("RESIDENT", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  uploadUserDocument("user_documents").fields([
    { name: "aadhar", maxCount: 1 },
    { name: "pan", maxCount: 1 },
  ]),
  uploadDocumentsController
);


// GET /api/user-documents/my — resident fetches their own docs
router.get(
  "/my",
  auth,
  role("RESIDENT", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  async (req, res) => {
    try {
      const UserDocuments = require("../models/UserDocuments");
      const doc = await UserDocuments.findOne({
        where: { user_id: req.user.id }
      });
      if (!doc) return res.status(404).json(null);
      res.json(doc);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/user-documents/:type  (type = "aadhar" | "pan")
router.patch(
  "/:type",
  auth,
  role("RESIDENT", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  (req, res, next) => {
    const { type } = req.params;
    if (!["aadhar", "pan"].includes(type)) {
      return res.status(400).json({ message: "Invalid document type. Use 'aadhar' or 'pan'" });
    }
    next();
  },
  uploadUserDocument("user_documents").fields([
    { name: "aadhar", maxCount: 1 },
    { name: "pan",    maxCount: 1 },
  ]),
  updateDocumentController
);

// DELETE /api/user-documents/:type  (type = "aadhar" | "pan")
router.delete(
  "/:type",
  auth,
  role("RESIDENT", "SOCIETY_ADMIN", "SUPER_ADMIN"),
  deleteDocumentController
);

module.exports = router;