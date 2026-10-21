const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const {
  SOCIETY_LOGO_MIMES,
  SOCIETY_LOGO_MAX_BYTES,
  SOCIETY_LOGO_FOLDER,
  buildSocietyLogoPublicId,
} = require("../utils/societyLogo");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => {
    const targetSocietyId = req.params?.id || req.user?.society_id || "general";
    return {
      folder: SOCIETY_LOGO_FOLDER,
      resource_type: "auto",
      public_id: buildSocietyLogoPublicId(targetSocietyId),
      use_filename: false,
      unique_filename: false,
      overwrite: false,
    };
  },
});

const fileFilter = (req, file, cb) => {
  if (SOCIETY_LOGO_MIMES.has(file.mimetype)) {
    return cb(null, true);
  }
  const error = new Error("Only JPEG, PNG, or WEBP images are allowed for society logo.");
  error.code = "INVALID_FILE_TYPE";
  cb(error, false);
};

const uploadSocietyLogo = multer({
  storage,
  fileFilter,
  limits: { fileSize: SOCIETY_LOGO_MAX_BYTES, files: 1 },
});

module.exports = uploadSocietyLogo;
