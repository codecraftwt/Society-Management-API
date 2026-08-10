


const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

/**
 * Shared multer middleware — stores files directly in Cloudinary.
 * No local disk writes, works on Render / any ephemeral filesystem.
 *
 * Usage in routes (unchanged):
 *   upload("notices").single("file")
 *   upload("documents").single("file")
 *   upload("avatars").single("photo")
 *
 * After upload:
 *   req.file.path         = full Cloudinary https URL  ← store this in DB
 *   req.file.filename     = Cloudinary public_id
 *   req.file.originalname = original filename with extension (e.g. "Report.pdf")
 *
 * KEY FIX: For raw files (non-image), we do NOT strip the extension from
 * public_id. Cloudinary preserves it in the URL so the frontend can detect
 * the file type correctly (e.g. .pdf, .docx, .xlsx).
 */
const upload = (folder) => {
  const IMAGE_MIMES = new Set([
    "image/jpeg", "image/png", "image/gif",
    "image/webp", "image/svg+xml",
  ]);

  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const isImage = IMAGE_MIMES.has(file.mimetype);

      // For images: strip extension (Cloudinary manages image format itself)
      // For raw files (pdf, docx, xlsx...): KEEP the extension in public_id
      // so the final URL contains it and the frontend can detect file type.
      const safeName = file.originalname.replace(/\s+/g, "_");
      const publicId = isImage
        ? `${Date.now()}-${safeName.replace(/\.[^/.]+$/, "")}` // images: no ext
        : `${Date.now()}-${safeName}`;                          // raw: keep ext

      return {
        folder:          `society/${folder}`,
        resource_type:   isImage ? "image" : "raw",
        public_id:       publicId,
        use_filename:    false,
        unique_filename: false,
      };
    },
  });

  return multer({ storage });
};

module.exports = upload;