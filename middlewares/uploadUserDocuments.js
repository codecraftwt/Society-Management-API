const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const upload = (folder) => {
  const IMAGE_MIMES = new Set([
    "image/jpeg", "image/png", "image/gif",
    "image/webp", "image/svg+xml",
  ]);

  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const isImage = IMAGE_MIMES.has(file.mimetype);

      // 🔥 Get userId (from auth middleware)
      const userId = req.query?.userId || req.user?.id || "unknown";

      // 🔥 Detect doc type from field name
      // (important: aadhar / pan)
      const docType = file.fieldname; // "aadhar" or "pan"

      return {
        folder: `society/user_documents/${userId}`,
        resource_type: isImage ? "image" : "raw",

        // 🔥 Clean structured naming
        public_id: `${docType}`, // aadhar / pan

        overwrite: true, // replace if re-uploaded
      };
    },
  });

  return multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
      if (
        file.mimetype === "application/pdf" ||
        file.mimetype.startsWith("image/")
      ) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF/Image allowed"), false);
      }
    },
  });
};

module.exports = upload;


