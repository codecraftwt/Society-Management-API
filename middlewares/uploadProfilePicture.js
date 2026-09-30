const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const {
  PROFILE_PICTURE_MIMES,
  PROFILE_PICTURE_MAX_BYTES,
  PROFILE_PICTURE_FOLDER,
  buildProfilePicturePublicId,
} = require("../utils/profilePicture");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => {
    const targetUserId = req.params?.id || req.user?.id;
    return {
      folder: PROFILE_PICTURE_FOLDER,
      resource_type: "auto",
      public_id: buildProfilePicturePublicId(targetUserId),
      use_filename: false,
      unique_filename: false,
      overwrite: false,
    };
  },
});

const fileFilter = (req, file, cb) => {
  if (PROFILE_PICTURE_MIMES.has(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error("Only JPEG, PNG, WEBP, GIF, HEIC or HEIF images are allowed for a profile picture."));
};

const uploadProfilePicture = multer({
  storage,
  fileFilter,
  limits: { fileSize: PROFILE_PICTURE_MAX_BYTES, files: 1 },
});

module.exports = uploadProfilePicture;
module.exports.uploadProfilePicture = uploadProfilePicture;
