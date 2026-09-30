const multer = require("multer");

const handleProfilePictureUploadErrors = (err, req, res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Image is too large. Maximum size is 5MB." });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Send exactly one image in the 'photo' field." });
    }
    return res.status(400).json({ message: "Could not read the uploaded image." });
  }

  return res.status(400).json({ message: err.message || "Invalid image upload." });
};

module.exports = handleProfilePictureUploadErrors;
