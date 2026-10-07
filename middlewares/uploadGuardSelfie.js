const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const SELFIE_FOLDER = "society/guard-attendance-selfies";
const SELFIE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const SELFIE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: SELFIE_FOLDER,
    resource_type: "auto",
    public_id: `guard-${req.user?.id}-selfie-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    use_filename: false,
    unique_filename: false,
    overwrite: false,
  }),
});

const fileFilter = (req, file, cb) => {
  if (SELFIE_MIMES.has(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error("Only JPEG, PNG, WEBP, HEIC or HEIF images are allowed for attendance selfie."));
};

const uploadGuardSelfie = multer({
  storage,
  fileFilter,
  limits: { fileSize: SELFIE_MAX_BYTES, files: 1 },
});

module.exports = uploadGuardSelfie;
module.exports.SELFIE_FOLDER = SELFIE_FOLDER;
module.exports.SELFIE_MAX_BYTES = SELFIE_MAX_BYTES;
