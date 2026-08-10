
const multer    = require("multer");
const cloudinary = require("../config/cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          "complaint_comments/images",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    transformation:  [
      { width: 1200, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" },
    ],
  },
});

const IMAGE_MIME = /^image\//;
const ALLOWED_RAW = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const memStorage = multer.memoryStorage();

const dynamicStorage = {
  _handleFile(req, file, cb) {
    if (IMAGE_MIME.test(file.mimetype)) {
      imageStorage._handleFile(req, file, cb);
    } else {
      memStorage._handleFile(req, file, cb);
    }
  },
  _removeFile(req, file, cb) {
    if (IMAGE_MIME.test(file.mimetype)) {
      imageStorage._removeFile(req, file, cb);
    } else {
      memStorage._removeFile(req, file, cb);
    }
  },
};

const fileFilter = (req, file, cb) => {
  if (IMAGE_MIME.test(file.mimetype) || ALLOWED_RAW.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type"), false);
  }
};

module.exports = multer({
  storage:    dynamicStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});