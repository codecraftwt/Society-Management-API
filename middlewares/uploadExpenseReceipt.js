const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const images = new Set(["image/jpeg", "image/png", "image/webp"]);
const middleware = multer({ storage: new CloudinaryStorage({ cloudinary, params: async (req, file) => ({ folder: "society/expense-receipts", resource_type: images.has(file.mimetype) ? "image" : "raw", public_id: `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}` }) }), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)) }).single("receipt");

module.exports = (req, res, next) => middleware(req, res, (err) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ success: false, message: err.code === "LIMIT_FILE_SIZE" ? "Receipt must be 10MB or smaller." : (err.message || "Invalid receipt upload.") });
  }
  next();
});
