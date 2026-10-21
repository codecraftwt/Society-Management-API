const cloudinary = require("../config/cloudinary");

const SOCIETY_LOGO_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SOCIETY_LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const SOCIETY_LOGO_FOLDER = "society/logos";

const DELIVERY_TRANSFORMATION = "f_auto,q_auto,w_800,c_limit";

const getCloudName = () => process.env.CLOUD_NAME || cloudinary.config().cloud_name || "";

const buildSocietyLogoPublicId = (societyId) =>
  `society-${societyId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildSocietyLogoUrl = (publicId) => {
  if (!publicId) return null;
  const cloudName = getCloudName();
  if (!cloudName) return null;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${DELIVERY_TRANSFORMATION}/${publicId}`;
};

const isAcceptedSocietyLogoMime = (mimetype) => SOCIETY_LOGO_MIMES.has(mimetype);

const destroySocietyLogo = async (publicId) => {
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    if (result && (result.result === "ok" || result.result === "not found")) return true;
    console.error(`[SocietyLogo] Cloudinary destroy returned "${result && result.result}" for ${publicId}`);
    return false;
  } catch (err) {
    console.error(`[SocietyLogo] Failed to destroy ${publicId}:`, err.message);
    return false;
  }
};

const readUploadedSocietyLogo = (file) => {
  if (!file) return null;
  const publicId = file.filename;
  const url = buildSocietyLogoUrl(publicId) || file.path || null;
  if (!url) return null;
  return { url, publicId };
};

module.exports = {
  SOCIETY_LOGO_MIMES,
  SOCIETY_LOGO_MAX_BYTES,
  SOCIETY_LOGO_FOLDER,
  buildSocietyLogoPublicId,
  buildSocietyLogoUrl,
  isAcceptedSocietyLogoMime,
  destroySocietyLogo,
  readUploadedSocietyLogo,
};
