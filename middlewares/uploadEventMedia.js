const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/3gpp",
]);

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = VIDEO_MIMES.has(file.mimetype);
    const safeName = file.originalname.replace(/\s+/g, "_").replace(/\.[^/.]+$/, "");
    const publicId = `${Date.now()}-${safeName}`;

    return {
      folder: "society/events",
      resource_type: isVideo ? "video" : "image",
      public_id: publicId,
      use_filename: false,
      unique_filename: false,
    };
  },
});

const fileFilter = (req, file, cb) => {
  if (IMAGE_MIMES.has(file.mimetype) || VIDEO_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Supported formats: JPG, PNG, WEBP, GIF, MP4, WEBM, MOV, 3GP."), false);
  }
};

const uploadEventMedia = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max (for videos)
}).fields([
  { name: "photos", maxCount: 10 },
  { name: "videos", maxCount: 5 },
]);

module.exports = uploadEventMedia;
