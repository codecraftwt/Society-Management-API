const cloudinary = require("../config/cloudinary");

const PROFILE_PICTURE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

const PROFILE_PICTURE_FOLDER = "society/avatars";

const DELIVERY_TRANSFORMATION = "f_auto,q_auto,w_400,h_400,c_fill";

const getCloudName = () => process.env.CLOUD_NAME || cloudinary.config().cloud_name || "";

const buildProfilePicturePublicId = (userId) =>
  `user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildProfilePictureUrl = (publicId) => {
  if (!publicId) return null;
  const cloudName = getCloudName();
  if (!cloudName) return null;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${DELIVERY_TRANSFORMATION}/${publicId}`;
};

// Cloudinary echoes back the public_id WITH the folder it was stored in, so the
// value on req.file.filename is "<folder>/user-<id>-<ts>-<rand>". Match on the
// final path segment, otherwise every ownership check fails and the upload is
// rejected with "Invalid image reference."
const isProfilePictureOwnedBy = (publicId, userId) => {
  if (!publicId || !userId) return false;
  const segments = String(publicId).split("/").filter(Boolean);
  const name = segments[segments.length - 1] || "";
  return name.startsWith(`user-${userId}-`);
};

const isAcceptedProfilePictureMime = (mimetype) => PROFILE_PICTURE_MIMES.has(mimetype);

const destroyProfilePicture = async (publicId) => {
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    if (result && result.result === "ok") return true;
    console.error(`[ProfilePicture] Cloudinary destroy returned "${result && result.result}" for ${publicId}`);
    return false;
  } catch (err) {
    console.error(`[ProfilePicture] Failed to destroy ${publicId}:`, err.message);
    return false;
  }
};

const readUploadedProfilePicture = (file) => {
  if (!file) return null;
  const publicId = file.filename;
  const url = buildProfilePictureUrl(publicId) || file.path || null;
  if (!url) return null;
  return { url, publicId };
};

/**
 * multipart/form-data delivers every field as a string, so JSON/array/object
 * fields arrive as JSON text instead of real structures. Normalise them back so
 * the rest of the controller can treat JSON and multipart bodies identically.
 */
const parseMultipartJsonField = (value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
};

const normaliseMultipartBody = (body) => {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  ["flat_assignments", "emergency_contact", "vehicles", "parking_slots"].forEach((key) => {
    if (key in out) out[key] = parseMultipartJsonField(out[key]);
  });
  return out;
};

module.exports = {
  PROFILE_PICTURE_MIMES,
  PROFILE_PICTURE_MAX_BYTES,
  PROFILE_PICTURE_FOLDER,
  buildProfilePicturePublicId,
  buildProfilePictureUrl,
  isProfilePictureOwnedBy,
  isAcceptedProfilePictureMime,
  destroyProfilePicture,
  readUploadedProfilePicture,
  parseMultipartJsonField,
  normaliseMultipartBody,
};
