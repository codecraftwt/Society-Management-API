const { Op } = require("sequelize");
const {
  GuardAttendance,
  GuardShift,
  Society,
  User,
} = require("../models");
const { getCurrentISTDate, getCurrentISTDateTime } = require("../utils/istTime");
const { getShiftTimings, isTimeInShift } = require("../utils/shiftTiming");
const cloudinary = require("../config/cloudinary");
const { buildProfilePictureUrl } = require("../utils/profilePicture");

/* �����������������������������������������������������������������
   HELPERS
   ����������������������������������������������������������������� */

const MAX_GPS_ACCURACY_METERS = Number(process.env.MAX_GPS_ACCURACY_METERS || 50);

/**
 * Haversine distance in metres between two lat/lng pairs.
 * Server is the sole authority for geofence verification.
 */
const haversineMetres = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth radius in metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Wrap an async fn into a clean 500 handler. */
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error("[guardAttendance]", err);
    // If a Cloudinary file was uploaded but we errored out, delete it
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    res.status(500).json({ message: err.message || "Guard attendance request failed" });
  }
};

/** Build Cloudinary delivery URL from public_id. */
const buildSelfieUrl = (publicId) => {
  if (!publicId) return null;
  const cloudName = process.env.CLOUD_NAME || cloudinary.config().cloud_name || "";
  if (!cloudName) return null;
  return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto,w_400,h_400,c_fill/${publicId}`;
};

/* ─────────────────────────────────────────────────────────────────
   SERVER-AUTHORITATIVE PUNCH-IN
   ───────────────────────────────────────────────────────────────── */

/**
 * POST /api/guard-attendance/punch-in
 *
 * Validates (in order):
 *  1. Guard is authenticated (handled by auth middleware)
 *  2. Guard is ACTIVE (status = ACTIVE)
 *  3. Guard has exactly one valid active shift covering today
 *  4. Society location is configured (lat/lng not null)
 *  5. Guard's GPS coordinates are present and valid numbers
 *  6. Guard is within the configured radius
 *  7. A selfie file is present
 *  8. Selfie is within allowed MIME + size (handled by multer middleware)
 *  9. No attendance already exists for the same guard+shift+date
 * 10. Create the row
 *
 * Body (multipart/form-data):
 *   selfie  — image file (required)
 *   lat     — float string
 *   lng     — float string
 */
const punchIn = handle(async (req, res) => {
  const guardId = req.user.id;
  let societyId = req.user.society_id;

  // ── 1. Guard status & society resolution ──
  const guard = await User.findByPk(guardId, { attributes: ["id", "society_id", "status", "role"] });
  if (!societyId && guard?.society_id) {
    societyId = guard.society_id;
  }

  if (!societyId) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(403).json({ message: "You are not assigned to any society." });
  }

  if (!guard || guard.status !== "ACTIVE") {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(403).json({
      message: "Your account is not active. Please contact the society admin.",
      code: "GUARD_NOT_ACTIVE",
    });
  }

  // ── 2. Exactly one active shift for today ──
  const today = getCurrentISTDate();
  const timings = await getShiftTimings(societyId);

  const todayShifts = await GuardShift.findAll({
    where: {
      guard_id: guardId,
      society_id: societyId,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  if (todayShifts.length === 0) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(403).json({
      message: "No shift is assigned to you for today.",
      code: "NO_SHIFT_TODAY",
    });
  }

  if (todayShifts.length > 1) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(409).json({
      message: "You have more than one shift covering today. Please contact admin to fix overlapping shifts.",
      code: "MULTIPLE_SHIFTS",
    });
  }

  const myShift = todayShifts[0];

  // ── 3. Verify shift window is currently active ──
  if (!isTimeInShift(timings, myShift.shift_type)) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    const t = timings[myShift.shift_type] || {};
    return res.status(403).json({
      message: `You are outside your shift window (${t.start || "?"} – ${t.end || "?"}).`,
      code: "OUTSIDE_SHIFT_WINDOW",
    });
  }

  // ── 4. Society location must be configured ──
  const society = await Society.findByPk(societyId, {
    attributes: ["latitude", "longitude", "location_radius"],
  });

  if (!society || society.latitude == null || society.longitude == null) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(400).json({
      message: "Society location has not been configured yet. Please contact admin.",
      code: "GEOFENCE_NOT_CONFIGURED",
    });
  }

  // ── 5. Guard GPS coordinates must be present and valid ──
  const lat = parseFloat(req.body?.lat);
  const lng = parseFloat(req.body?.lng);
  const accuracy = req.body?.accuracy != null ? parseFloat(req.body.accuracy) : null;

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(400).json({
      message: "Valid GPS coordinates (lat, lng) are required.",
      code: "INVALID_GPS",
    });
  }

  // ── 6. Geofence check — server is authoritative ──
  const distanceMetres = haversineMetres(
    parseFloat(society.latitude),
    parseFloat(society.longitude),
    lat,
    lng
  );
  const radiusMetres = parseFloat(society.location_radius) || 50;

  if (distanceMetres > radiusMetres) {
    if (req.file?.filename) {
      cloudinary.uploader.destroy(req.file.filename, { resource_type: "image" }).catch(() => {});
    }
    return res.status(403).json({
      message: "You are outside the society location. Please move closer to the society and try again.",
      code: "OUTSIDE_GEOFENCE",
      distance_metres: Math.round(distanceMetres),
      allowed_radius: radiusMetres,
    });
  }

  // ── 7. Selfie must be present (MIME + size already validated by multer) ──
  if (!req.file) {
    return res.status(400).json({ message: "A selfie photo is required to punch in.", code: "SELFIE_REQUIRED" });
  }

  const selfiePublicId = req.file.filename;
  const selfieUrl = buildSelfieUrl(selfiePublicId);

  // ── 8. No existing attendance for same guard + shift + date ──
  const existing = await GuardAttendance.findOne({
    where: { guard_id: guardId, shift_id: myShift.id, attendance_date: today },
  });

  if (existing) {
    cloudinary.uploader.destroy(selfiePublicId, { resource_type: "image" }).catch(() => {});
    return res.status(409).json({
      message: "You have already punched in for this shift today.",
      code: "ALREADY_PUNCHED_IN",
      attendance: existing,
    });
  }

  // ── 9. Create the attendance row with server timestamp ──
  const attendance = await GuardAttendance.create({
    guard_id: guardId,
    shift_id: myShift.id,
    society_id: societyId,
    attendance_date: today,
    punch_in: new Date(),
    punch_in_lat: lat,
    punch_in_lng: lng,
    punch_in_accuracy: !isNaN(accuracy) ? accuracy : null,
    punch_in_distance: Math.round(distanceMetres * 100) / 100,
    punch_in_radius: radiusMetres,
    punch_in_selfie_public_id: selfiePublicId,
    punch_in_selfie_url: selfieUrl,
    status: "PUNCHED_IN",
  });

  return res.status(201).json({
    success: true,
    message: "Punch-in recorded successfully.",
    attendance: attendance.toJSON(),
    server_now: getCurrentISTDateTime(),
    timezone: "Asia/Kolkata",
  });
});

/* ─────────────────────────────────────────────────────────────────
   SERVER-AUTHORITATIVE PUNCH-OUT (NO PHOTO REQUIRED)
   ───────────────────────────────────────────────────────────────── */

/**
 * POST /api/guard-attendance/punch-out
 *
 * Validates:
 *  1. Guard has an existing PUNCHED_IN record for today
 *  2. Guard GPS coordinates present & inside geofence
 *  3. Computes worked_minutes = (punchOutTime - punchInTime)
 *  4. Updates row to PUNCHED_OUT
 */
const punchOut = handle(async (req, res) => {
  const guardId = req.user.id;
  let societyId = req.user.society_id;

  const guard = await User.findByPk(guardId, { attributes: ["id", "society_id", "status", "role"] });
  if (!societyId && guard?.society_id) {
    societyId = guard.society_id;
  }

  if (!societyId) {
    return res.status(403).json({ message: "You are not assigned to any society." });
  }

  const today = getCurrentISTDate();

  // ── 1. Must have an existing PUNCHED_IN record for today ──
  const attendance = await GuardAttendance.findOne({
    where: { guard_id: guardId, society_id: societyId, attendance_date: today, status: "PUNCHED_IN" },
  });

  if (!attendance) {
    return res.status(404).json({
      message: "No active punch-in found for today. Please punch in first.",
      code: "NO_ACTIVE_PUNCH_IN",
    });
  }

  // ── 2. Society geofence must be configured ──
  const society = await Society.findByPk(societyId, {
    attributes: ["latitude", "longitude", "location_radius"],
  });

  if (!society || society.latitude == null || society.longitude == null) {
    return res.status(400).json({
      message: "Society location has not been configured. Please contact admin.",
      code: "GEOFENCE_NOT_CONFIGURED",
    });
  }

  // ── 3. GPS coordinates ──
  const lat = parseFloat(req.body?.lat);
  const lng = parseFloat(req.body?.lng);
  const accuracy = req.body?.accuracy != null ? parseFloat(req.body.accuracy) : null;

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ message: "Valid GPS coordinates (lat, lng) are required.", code: "INVALID_GPS" });
  }

  // ── 4. Geofence check ──
  const distanceMetres = haversineMetres(
    parseFloat(society.latitude),
    parseFloat(society.longitude),
    lat,
    lng
  );
  const radiusMetres = parseFloat(society.location_radius) || 50;

  if (distanceMetres > radiusMetres) {
    return res.status(403).json({
      message: "You are outside the society location. Please move closer to the society and try again.",
      code: "OUTSIDE_GEOFENCE",
      distance_metres: Math.round(distanceMetres),
      allowed_radius: radiusMetres,
    });
  }

  // Optional selfie if provided, but NOT required
  const selfiePublicId = req.file?.filename || null;
  const selfieUrl = selfiePublicId ? buildSelfieUrl(selfiePublicId) : null;

  // ── 5. Compute worked_minutes ──
  const punchOutTime = new Date();
  const punchInTime = new Date(attendance.punch_in);
  const workedMinutes = Math.max(0, Math.round((punchOutTime - punchInTime) / 60000));

  // ── 6. Update the row ──
  await attendance.update({
    punch_out: punchOutTime,
    punch_out_lat: lat,
    punch_out_lng: lng,
    punch_out_accuracy: !isNaN(accuracy) ? accuracy : null,
    punch_out_distance: Math.round(distanceMetres * 100) / 100,
    ...(selfiePublicId ? { punch_out_selfie_public_id: selfiePublicId, punch_out_selfie_url: selfieUrl } : {}),
    worked_minutes: workedMinutes,
    status: "PUNCHED_OUT",
  });

  return res.status(200).json({
    success: true,
    message: "Punch-out recorded successfully.",
    attendance: attendance.toJSON(),
    worked_minutes: workedMinutes,
    server_now: getCurrentISTDateTime(),
    timezone: "Asia/Kolkata",
  });
});

/* ─────────────────────────────────────────────────────────────────
   GET TODAY'S RECORD (Guard self-view)
   ───────────────────────────────────────────────────────────────── */

const getTodayAttendance = handle(async (req, res) => {
  const guardId = req.user.id;
  const societyId = req.user.society_id;
  const today = getCurrentISTDate();

  const attendance = await GuardAttendance.findOne({
    where: { guard_id: guardId, society_id: societyId, attendance_date: today },
    include: [{ model: GuardShift, as: "shift", attributes: ["shift_type", "start_date", "end_date"] }],
  });

  return res.status(200).json({
    success: true,
    today: today,
    attendance: attendance || null,
    server_now: getCurrentISTDateTime(),
    timezone: "Asia/Kolkata",
  });
});

/* ─────────────────────────────────────────────────────────────────
   ADMIN & SUPER ADMIN — LIST ATTENDANCE (with filters)
   ───────────────────────────────────────────────────────────────── */

const listAttendance = handle(async (req, res) => {
  let societyId = req.user.society_id;
  if (req.user.role === "SUPER_ADMIN") {
    const raw = req.query.society_id || req.headers["x-society-id"];
    societyId = raw && raw !== "ALL" ? parseInt(raw, 10) : null;
  }

  if (!societyId && req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "You are not assigned to any society." });
  }

  const { date, guard_id, status, page = 1, limit = 50 } = req.query;
  const where = {};
  if (societyId) where.society_id = societyId;

  if (date) where.attendance_date = date;
  if (guard_id) where.guard_id = parseInt(guard_id, 10);
  if (status) where.status = status;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const { rows, count } = await GuardAttendance.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: "guard",
        attributes: ["id", "name", "phone", "profile_picture"],
      },
      {
        model: GuardShift,
        as: "shift",
        attributes: ["shift_type", "start_date", "end_date"],
      },
      {
        model: Society,
        as: "society",
        attributes: ["id", "name"],
      },
    ],
    order: [["attendance_date", "DESC"], ["punch_in", "DESC"]],
    limit: parseInt(limit, 10),
    offset,
  });

  return res.status(200).json({
    success: true,
    total: count,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    data: rows,
  });
});

/* ─────────────────────────────────────────────────────────────────
   ADMIN & SUPER ADMIN — GET TODAY'S GUARD ATTENDANCE SUMMARY
   ───────────────────────────────────────────────────────────────── */

const getTodaySummary = handle(async (req, res) => {
  let societyId = req.user.society_id;
  if (req.user.role === "SUPER_ADMIN") {
    const raw = req.query.society_id || req.headers["x-society-id"];
    societyId = raw && raw !== "ALL" ? parseInt(raw, 10) : null;
  }

  if (!societyId && req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "You are not assigned to any society." });
  }

  const today = getCurrentISTDate();
  const where = { attendance_date: today };
  if (societyId) where.society_id = societyId;

  const records = await GuardAttendance.findAll({
    where,
    include: [
      { model: User, as: "guard", attributes: ["id", "name", "phone", "profile_picture"] },
      { model: GuardShift, as: "shift", attributes: ["shift_type"] },
      { model: Society, as: "society", attributes: ["id", "name"] },
    ],
    order: [["punch_in", "ASC"]],
  });

  return res.status(200).json({
    success: true,
    date: today,
    total: records.length,
    punched_in: records.filter((r) => r.status === "PUNCHED_IN").length,
    punched_out: records.filter((r) => r.status === "PUNCHED_OUT").length,
    data: records,
    server_now: getCurrentISTDateTime(),
  });
});

/* ─────────────────────────────────────────────────────────────────
   ADMIN & SUPER ADMIN — MANUAL CORRECTION
   ───────────────────────────────────────────────────────────────── */

const manualCorrection = handle(async (req, res) => {
  let societyId = req.user.society_id;
  if (req.user.role === "SUPER_ADMIN") {
    const raw = req.query.society_id || req.body?.society_id;
    societyId = raw && raw !== "ALL" ? parseInt(raw, 10) : null;
  }
  const { id } = req.params;
  const { punch_in, punch_out, notes } = req.body;

  const where = { id };
  if (societyId) where.society_id = societyId;

  const attendance = await GuardAttendance.findOne({ where });
  if (!attendance) {
    return res.status(404).json({ message: "Attendance record not found." });
  }

  const updates = { is_manual: true, manually_edited_by: req.user.id, notes: notes || attendance.notes };

  if (punch_in) updates.punch_in = new Date(punch_in);
  if (punch_out) {
    updates.punch_out = new Date(punch_out);
    updates.status = "PUNCHED_OUT";
    const pIn = new Date(punch_in || attendance.punch_in);
    const pOut = new Date(punch_out);
    if (!isNaN(pIn) && !isNaN(pOut) && pOut > pIn) {
      updates.worked_minutes = Math.round((pOut - pIn) / 60000);
    }
  }

  await attendance.update(updates);

  return res.status(200).json({
    success: true,
    message: "Attendance manually corrected.",
    attendance: attendance.toJSON(),
  });
});

module.exports = {
  punchIn,
  punchOut,
  getTodayAttendance,
  listAttendance,
  getTodaySummary,
  manualCorrection,
};
