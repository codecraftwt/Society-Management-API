const multer = require("multer");

const handleSocietyLogoUploadErrors = (err, req, res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "Logo image is too large. Maximum allowed size is 5MB." });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ success: false, message: "Please provide a single image file in the 'logo' field." });
    }
    return res.status(400).json({ success: false, message: "Could not process the uploaded logo image." });
  }

  return res.status(400).json({ success: false, message: err.message || "Invalid logo image upload." });
};

module.exports = handleSocietyLogoUploadErrors;
