const express    = require("express");
const router     = express.Router();
const https      = require("https");
const http       = require("http");
const path       = require("path");
const { URL }    = require("url");
const cloudinary = require("../config/cloudinary");

// ── Simple in-memory rate limiter ──
const rateLimitMap = new Map();
const RATE_LIMIT   = 30;       // max requests
const RATE_WINDOW  = 60 * 1000; // per 60 seconds

function rateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }

  const entry = rateLimitMap.get(ip);

  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }

  entry.count++;

  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ message: "Too many requests. Try again later." });
  }

  next();
}

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.start > RATE_WINDOW) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ── MIME types ──
const MIME_MAP = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip":  "application/zip",
  ".txt":  "text/plain",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
};

function getMime(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function extractPublicId(cloudinaryUrl) {
  try {
    const parsed    = new URL(cloudinaryUrl);
    const pathname  = parsed.pathname;
    const uploadIdx = pathname.indexOf("/upload/");
    if (uploadIdx === -1) return null;
    const afterUpload = pathname.substring(uploadIdx + 8);
    return afterUpload.replace(/^v\d+\//, "");
  } catch {
    return null;
  }
}

function extractResourceType(cloudinaryUrl) {
  try {
    const parsed = new URL(cloudinaryUrl);
    const parts  = parsed.pathname.split("/");
    const idx    = parts.indexOf("upload");
    if (idx >= 2) return parts[idx - 1];
    return "raw";
  } catch {
    return "raw";
  }
}

function fetchWithRedirects(targetUrl, callback, maxRedirects = 5) {
  if (maxRedirects <= 0) {
    return callback(new Error("Too many redirects"), null);
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return callback(new Error("Invalid URL"), null);
  }

  const transport = parsed.protocol === "https:" ? https : http;

  transport.get(targetUrl, (upstream) => {
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
      upstream.resume();
      return fetchWithRedirects(upstream.headers.location, callback, maxRedirects - 1);
    }
    callback(null, upstream);
  }).on("error", (err) => {
    callback(err, null);
  });
}

function pipeResponse(upstream, res, mime, disposition, filename) {
  res.setHeader("Content-Type", mime);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(filename)}"`
  );
  if (upstream.headers["content-length"]) {
    res.setHeader("Content-Length", upstream.headers["content-length"]);
  }
  res.removeHeader("ETag");
  res.setHeader("Cache-Control", "private, max-age=3600");
  upstream.pipe(res);
  upstream.on("error", (streamErr) => {
    console.error("[download proxy] stream error:", streamErr.message);
    if (!res.headersSent) res.status(502).json({ message: "Stream error" });
  });
}

// ── Main route with rate limiting ──
router.get("/", rateLimit, async (req, res) => {
  const { url, name, mode } = req.query;

  if (!url) return res.status(400).json({ message: "Missing 'url' query param" });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ message: "Invalid URL" }); }

  if (parsed.hostname !== "res.cloudinary.com") {
    return res.status(403).json({ message: "Forbidden origin" });
  }

  const filename     = name || "attachment";
  const mime         = getMime(filename);
  const disposition  = mode === "download" ? "attachment" : "inline";
  const publicId     = extractPublicId(url);
  const resourceType = extractResourceType(url);

  if (!publicId) {
    return res.status(400).json({ message: "Could not parse file URL" });
  }

  // Build list of URLs to try
  const urlsToTry = [];

  try {
    const privateUrl = cloudinary.utils.private_download_url(publicId, "", {
      resource_type: resourceType,
      type:          "upload",
      expires_at:    Math.floor(Date.now() / 1000) + 300,
    });
    urlsToTry.push({ name: "private_download", url: privateUrl });
  } catch (e) {
    // skip
  }

  try {
    const resource = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: "upload",
    });

    const signedUrl = cloudinary.url(publicId, {
      resource_type: resourceType,
      type:          "upload",
      secure:        true,
      sign_url:      true,
      version:       resource.version,
    });
    urlsToTry.push({ name: "signed", url: signedUrl });
    urlsToTry.push({ name: "secure_url", url: resource.secure_url });

    const attachUrl = cloudinary.url(publicId, {
      resource_type: resourceType,
      type:          "upload",
      secure:        true,
      sign_url:      true,
      version:       resource.version,
      flags:         "attachment",
    });
    urlsToTry.push({ name: "attachment", url: attachUrl });
  } catch (e) {
    // skip
  }

  urlsToTry.push({ name: "original", url });

  // Try each URL
  const tryNext = (index) => {
    if (index >= urlsToTry.length) {
      if (!res.headersSent) {
        res.status(502).json({ message: "Could not fetch file from storage" });
      }
      return;
    }

    const attempt = urlsToTry[index];

    fetchWithRedirects(attempt.url, (err, upstream) => {
      if (!err && upstream && upstream.statusCode === 200) {
        pipeResponse(upstream, res, mime, disposition, filename);
        return;
      }

      if (upstream) upstream.resume();
      tryNext(index + 1);
    });
  };

  tryNext(0);
});

module.exports = router;