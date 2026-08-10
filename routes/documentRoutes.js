const express = require("express");
const router  = express.Router();

const auth   = require("../middlewares/authMiddleware");
const role   = require("../middlewares/roleMiddleware");
const upload = require("../middlewares/uploadNotice");

const {
  getDocuments,
  adminGetDocuments,
  adminUploadDocument,
  adminUpdateDocument,
  adminDeleteDocument,
} = require("../controllers/documentControllers");

// ── RESIDENT ─────────────────────────────────────────────────
// GET /api/documents
router.get("/", auth, getDocuments);

// ── ADMIN ─────────────────────────────────────────────────────
// GET    /api/documents/admin
router.get("/admin", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN" ,"COMMITTEE_MEMBER"), adminGetDocuments);

// POST   /api/documents/admin
router.post("/admin", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN","COMMITTEE_MEMBER"), upload("documents").single("file"), adminUploadDocument);

// PATCH  /api/documents/admin/:id
router.patch("/admin/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN","COMMITTEE_MEMBER"), adminUpdateDocument);

// DELETE /api/documents/admin/:id          → soft delete
// DELETE /api/documents/admin/:id?hard=true → permanent
router.delete("/admin/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN","COMMITTEE_MEMBER"), adminDeleteDocument);

module.exports = router;