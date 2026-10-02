const { Op } = require("sequelize");
const { CleaningStaff, CleaningStaffPass, CleaningStaffAttendance } = require("../models");
const GuardShift = require("../models/GuardShift");
const { getCurrentISTDate } = require("../utils/istTime");
const { getShiftTimings, isTimeInShift } = require("../utils/shiftTiming");
const {
  sanitizeText,
  isEmpty,
  isValidMobile,
  isValidEmail,
  isValidPersonName,
  isValidISODate,
} = require("../utils/validation");
const {
  MAX_SCANS_PER_DAY,
  STAFF_STATUSES,
  PASS_STATUSES,
  generatePassCode,
  normalizePassCode,
  passesOverlap,
  calculateWorkedMinutes,
  resolveScanDirection,
  evaluatePassUsability,
} = require("../utils/cleaningStaffUtils");

const getTodayIST = () => getCurrentISTDate();

/* ───────────────────────────────────────────────────────────────────────────
   SHARED HELPERS
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Every controller starts from the caller's society. Refusing an unscoped
 * request here is what guarantees a society admin can never read or mutate
 * another society's staff by manipulating an :id.
 */
const requireSocietyContext = (req, res) => {
  const societyId = req.user?.society_id;
  if (!societyId) {
    res.status(403).json({ message: "You are not assigned to any society" });
    return null;
  }
  return societyId;
};

/** Load a staff row scoped to the caller's society. 404 for other societies too. */
const findScopedStaff = async (id, societyId) =>
  CleaningStaff.findOne({ where: { id, society_id: societyId } });

/** Wrap an async controller so a rejected promise becomes a clean 500. */
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error("[cleaningStaff]", err);
    res.status(500).json({ message: err.message || "Cleaning staff request failed" });
  }
};

/** Turn a Sequelize unique violation into the caller-supplied 409. */
const respondToUniqueConflict = (res, err, message, extra = {}) => {
  if (err?.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ message, ...extra });
  }
  return null;
};

/**
 * The caller must be a guard whose shift covers today AND whose shift window
 * contains the current IST minute. Mirrors the gate-pass verification guard so
 * both endpoints agree on what "on duty" means.
 */
const assertGuardOnDuty = async (req, res) => {
  const societyId = req.user?.society_id;
  if (!societyId) {
    res.status(403).json({ message: "You are not assigned to any society" });
    return null;
  }

  const { getCurrentISTMinutes } = require("../utils/istTime");
  const today = getTodayIST();
  const timings = await getShiftTimings(societyId);
  const minutes = getCurrentISTMinutes();

  const myShift = await GuardShift.findOne({
    where: {
      guard_id: req.user.id,
      society_id: societyId,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });

  if (!myShift || !isTimeInShift(timings, myShift.shift_type, minutes)) {
    res.status(403).json({
      message: "No active shift assigned to you right now. You are off duty.",
      code: "GUARD_OFF_DUTY",
    });
    return null;
  }

  return societyId;
};

/* ───────────────────────────────────────────────────────────────────────────
   1. STAFF MANAGEMENT (admin)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/cleaning-staff
 * List with optional status/search filters. Always society-scoped.
 */
const getCleaningStaff = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const { status, search } = req.query;
  const where = { society_id: societyId };

  if (status) {
    const normalized = String(status).toUpperCase();
    if (!STAFF_STATUSES.includes(normalized)) {
      return res.status(400).json({ message: `Status must be one of ${STAFF_STATUSES.join(", ")}` });
    }
    where.status = normalized;
  }

  if (search && String(search).trim()) {
    const term = sanitizeText(String(search).trim());
    where[Op.or] = [
      { name: { [Op.like]: `%${term}%` } },
      { phone: { [Op.like]: `%${term}%` } },
      { designation: { [Op.like]: `%${term}%` } },
    ];
  }

  const staff = await CleaningStaff.findAll({
    where,
    order: [["name", "ASC"]],
  });

  return res.status(200).json({ success: true, data: staff });
};

/**
 * GET /api/cleaning-staff/:id
 * Single staff record plus their current active pass.
 */
const getCleaningStaffById = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }

  const today = getTodayIST();
  const activePass = await CleaningStaffPass.findOne({
    where: { cleaning_staff_id: staff.id, society_id: societyId, status: "ACTIVE" },
    order: [["valid_date", "DESC"]],
  });

  return res.status(200).json({
    success: true,
    data: {
      ...staff.toJSON(),
      active_pass: activePass,
      today,
    },
  });
};

/**
 * POST /api/cleaning-staff
 * Create a staff record. Name/phone/email are validated with the shared helpers.
 */
const createCleaningStaff = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const {
    name,
    phone,
    email,
    address,
    designation,
    joining_date,
  } = req.body || {};

  const cleanName = sanitizeText(name);
  if (!isValidPersonName(cleanName) && !cleanName) {
    return res.status(400).json({ message: "Name is required" });
  }
  if (cleanName.length < 2) {
    return res.status(400).json({ message: "Name must be at least 2 characters" });
  }

  const cleanPhone = phone ? sanitizeText(String(phone)).replace(/\s/g, "") : null;
  if (cleanPhone && !isValidMobile(cleanPhone)) {
    return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number" });
  }

  const cleanEmail = email ? sanitizeText(String(email)).toLowerCase() : null;
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  let cleanJoiningDate = null;
  if (joining_date) {
    if (!isValidISODate(String(joining_date))) {
      return res.status(400).json({ message: "Joining date must be a valid date (YYYY-MM-DD)" });
    }
    cleanJoiningDate = String(joining_date);
  }

  try {
    const staff = await CleaningStaff.create({
      society_id: societyId,
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      address: address ? sanitizeText(String(address)) : null,
      designation: designation ? sanitizeText(String(designation)) : null,
      joining_date: cleanJoiningDate,
      status: "ACTIVE",
      created_by: req.user.id,
      ...(req.file?.filename ? { profile_picture: req.file.path } : {}),
    });

    return res.status(201).json({ success: true, message: "Cleaning staff created", data: staff });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUT /api/cleaning-staff/:id
 * Partial update. Only the fields present in the body are touched.
 */
const updateCleaningStaff = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }

  const body = req.body || {};
  const updates = {};

  if (body.name !== undefined) {
    const cleanName = sanitizeText(body.name);
    if (cleanName.length < 2) {
      return res.status(400).json({ message: "Name must be at least 2 characters" });
    }
    updates.name = cleanName;
  }

  if (body.phone !== undefined) {
    const cleanPhone = body.phone ? sanitizeText(String(body.phone)).replace(/\s/g, "") : null;
    if (cleanPhone && !isValidMobile(cleanPhone)) {
      return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number" });
    }
    updates.phone = cleanPhone;
  }

  if (body.email !== undefined) {
    const cleanEmail = body.email ? sanitizeText(String(body.email)).toLowerCase() : null;
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }
    updates.email = cleanEmail;
  }

  if (body.joining_date !== undefined) {
    if (body.joining_date === null || body.joining_date === "") {
      updates.joining_date = null;
    } else if (!isValidISODate(String(body.joining_date))) {
      return res.status(400).json({ message: "Joining date must be a valid date (YYYY-MM-DD)" });
    } else {
      updates.joining_date = String(body.joining_date);
    }
  }

  ["address", "designation"].forEach((key) => {
    if (body[key] !== undefined) {
      updates[key] = isEmpty(body[key]) ? null : sanitizeText(String(body[key]));
    }
  });

  await staff.update(updates);
  return res.status(200).json({ success: true, message: "Cleaning staff updated", data: staff });
};

/**
 * PATCH /api/cleaning-staff/:id/status
 * Toggle ACTIVE/INACTIVE. Records are never deleted so history stays intact.
 */
const updateCleaningStaffStatus = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }

  const requested = String(req.body?.status || "").toUpperCase();
  if (!STAFF_STATUSES.includes(requested)) {
    return res.status(400).json({ message: `Status must be one of ${STAFF_STATUSES.join(", ")}` });
  }

  await staff.update({ status: requested });

  /* Deactivating a staff member must not leave an ACTIVE pass at the gate. */
  if (requested === "INACTIVE") {
    await CleaningStaffPass.update(
      { status: "REVOKED", revoked_by: req.user.id, revoked_at: new Date(), revoke_reason: "Staff marked inactive" },
      { where: { cleaning_staff_id: staff.id, society_id: societyId, status: "ACTIVE" } }
    );
  }

  return res.status(200).json({ success: true, message: `Cleaning staff marked ${requested}`, data: staff });
};

/**
 * DELETE /api/cleaning-staff/:id
 * Not implemented by design. Use PATCH /:id/status instead so attendance and
 * pass history is never orphaned.
 */
const deleteCleaningStaffNotAllowed = async (req, res) =>
  res.status(405).json({
    message: "Cleaning staff records cannot be deleted. Mark the staff member INACTIVE instead to preserve attendance history.",
  });

/* ───────────────────────────────────────────────────────────────────────────
   2. PASSES (admin)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/cleaning-staff/:id/passes
 * Issue a pass. Rejects an overlapping ACTIVE pass with 409 inside a transaction
 * so two concurrent issuances cannot both pass the overlap check.
 */
const createCleaningStaffPass = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }
  if (staff.status !== "ACTIVE") {
    return res.status(400).json({ message: "Cannot issue a pass for an INACTIVE staff member" });
  }

  const { valid_date, valid_until } = req.body || {};
  if (!valid_date || !isValidISODate(String(valid_date))) {
    return res.status(400).json({ message: "valid_date is required and must be a valid date (YYYY-MM-DD)" });
  }

  let until = null;
  if (valid_until !== undefined && valid_until !== null && String(valid_until) !== "") {
    if (!isValidISODate(String(valid_until))) {
      return res.status(400).json({ message: "valid_until must be a valid date (YYYY-MM-DD)" });
    }
    until = String(valid_until);
    if (until < String(valid_date)) {
      return res.status(400).json({ message: "valid_until must be on or after valid_date" });
    }
  }

  const sequelize = require("../models").sequelize;

  try {
    const pass = await sequelize.transaction(async (t) => {
      /* Lock this staff member's pass rows for the duration of the check so two
         simultaneous requests cannot both observe "no overlap" and insert. */
      const existing = await CleaningStaffPass.findAll({
        where: { cleaning_staff_id: staff.id, society_id: societyId, status: "ACTIVE" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const clash = existing.find((p) => passesOverlap(p, valid_date, until));
      if (clash) {
        const conflict = new Error("PASS_OVERLAP");
        conflict.conflictingPass = clash;
        throw conflict;
      }

      /* Retry on the (astronomically unlikely) random-code collision so the
         caller never sees a raw DB error for a code we chose ourselves. */
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await CleaningStaffPass.create(
            {
              cleaning_staff_id: staff.id,
              society_id: societyId,
              pass_code: generatePassCode(),
              valid_date: String(valid_date),
              valid_until: until,
              status: "ACTIVE",
              max_scans_per_day: MAX_SCANS_PER_DAY,
              issued_by: req.user.id,
            },
            { transaction: t }
          );
        } catch (err) {
          if (err?.name === "SequelizeUniqueConstraintError" && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error("Could not allocate a unique pass code");
    });

    return res.status(201).json({ success: true, message: "Pass issued", data: pass });
  } catch (err) {
    if (err.message === "PASS_OVERLAP") {
      const clash = err.conflictingPass;
      return res.status(409).json({
        message: "This staff member already has an active pass covering those dates.",
        existing_pass: clash,
      });
    }
    const handled = respondToUniqueConflict(
      res,
      err,
      "Could not issue a unique pass code. Please try again.",
      {}
    );
    if (handled) return handled;
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/cleaning-staff/:id/passes
 * Pass history, newest first. Optional ?status filter.
 */
const getCleaningStaffPasses = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }

  const where = { cleaning_staff_id: staff.id, society_id: societyId };
  if (req.query.status) {
    const status = String(req.query.status).toUpperCase();
    if (!PASS_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of ${PASS_STATUSES.join(", ")}` });
    }
    where.status = status;
  }

  const passes = await CleaningStaffPass.findAll({
    where,
    order: [["created_at", "DESC"]],
  });

  return res.status(200).json({ success: true, data: passes });
};

/**
 * PATCH /api/cleaning-staff/passes/:passId/revoke
 * Revoke a pass. An already-closed attendance row is unaffected so the OUT scan
 * that already happened stays valid.
 */
const revokeCleaningStaffPass = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const pass = await CleaningStaffPass.findOne({
    where: { id: req.params.passId, society_id: societyId },
  });
  if (!pass) {
    return res.status(404).json({ message: "Pass not found" });
  }
  if (pass.status === "REVOKED") {
    return res.status(400).json({ message: "Pass is already revoked" });
  }

  await pass.update({
    status: "REVOKED",
    revoked_by: req.user.id,
    revoked_at: new Date(),
    revoke_reason: req.body?.reason ? sanitizeText(String(req.body.reason)) : null,
  });

  return res.status(200).json({ success: true, message: "Pass revoked", data: pass });
};

/* ───────────────────────────────────────────────────────────────────────────
   3. GATE SCAN (guard)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/cleaning-staff/scan
 *
 * Core gate logic:
 *  - Guard must be on duty in this society.
 *  - One attendance row per staff member per IST day.
 *  - Scan 1 = IN, scan 2 = OUT, scan 3+ = 400 (max_scans_per_day = 2).
 *  - A valid pass is required for IN.
 *  - OUT always closes a valid IN, even if the pass has since expired/revoked.
 *
 * The row is locked FOR UPDATE so two guards scanning the same staff member at
 * once cannot both read scan_count = 0 and both record an IN.
 */
const scanCleaningStaffPass = async (req, res) => {
  const societyId = await assertGuardOnDuty(req, res);
  if (!societyId) return;

  const code = normalizePassCode(req.body?.pass_code || req.body?.code || req.body?.gatePassCode);
  if (!code) {
    return res.status(400).json({ message: "A valid GP-XXXXXX pass code is required", code: "INVALID_PASS_CODE" });
  }

  const sequelize = require("../models").sequelize;
  const today = getTodayIST();

  try {
    const result = await sequelize.transaction(async (t) => {
      const pass = await CleaningStaffPass.findOne({
        where: { pass_code: code, society_id: societyId },
        transaction: t,
      });

      if (!pass) {
        const err = new Error("PASS_NOT_FOUND");
        err.httpStatus = 400;
        err.body = { message: "Invalid cleaning staff pass code", code: "PASS_NOT_FOUND" };
        throw err;
      }

      /* Lock today's attendance row so concurrent scans serialise. */
      let attendance = await CleaningStaffAttendance.findOne({
        where: { cleaning_staff_id: pass.cleaning_staff_id, attendance_date: today },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const direction = resolveScanDirection(attendance);

      /* ── Third scan of the day: reject before touching anything else ── */
      if (direction === "COMPLETED") {
        const err = new Error("DAILY_LIMIT_REACHED");
        err.httpStatus = 400;
        err.body = {
          message: `Today's scans are already complete (max ${MAX_SCANS_PER_DAY} per day: one entry and one exit).`,
          code: "DAILY_LIMIT_REACHED",
          max_scans_per_day: MAX_SCANS_PER_DAY,
        };
        throw err;
      }

      const usability = evaluatePassUsability(pass, today);

      /* ── IN: pass must be valid right now ── */
      if (direction === "IN") {
        if (!usability.usableForEntry) {
          const err = new Error("PASS_NOT_VALID");
          err.httpStatus = 400;
          err.body = { message: usability.message, code: usability.code, expired: usability.code === "PASS_EXPIRED" };
          throw err;
        }

        const now = new Date();
        const payload = {
          cleaning_staff_id: pass.cleaning_staff_id,
          society_id: societyId,
          attendance_date: today,
          check_in: now,
          scan_count: 1,
          pass_id: pass.id,
          in_guard_id: req.user.id,
          is_manual: false,
        };

        if (attendance) {
          /* Row already exists with check_in set — should have been COMPLETED,
             but recover defensively rather than corrupting the row. */
          await attendance.update(payload, { transaction: t });
        } else {
          attendance = await CleaningStaffAttendance.create(payload, { transaction: t });
        }

        /* Keep the pass row honest: it stays ACTIVE until it actually lapses. */
        const staff = await CleaningStaff.findByPk(pass.cleaning_staff_id, { transaction: t });

        return {
          direction: "IN",
          attendance,
          staff,
          pass,
          remaining: MAX_SCANS_PER_DAY - 1,
        };
      }

      /* ── OUT: always allowed once a valid IN exists, even if the pass
            has since expired or been revoked. Staff must not be trapped. ── */
      const now = new Date();
      const workedMinutes = calculateWorkedMinutes(attendance.check_in, now);

      await attendance.update(
        {
          check_out: now,
          worked_minutes: workedMinutes,
          scan_count: 2,
          out_guard_id: req.user.id,
        },
        { transaction: t }
      );

      /* Reflect the lapse on the pass row now that the day is done. */
      if (pass.status === "ACTIVE" && pass.valid_until && today > pass.valid_until) {
        await pass.update({ status: "EXPIRED" }, { transaction: t });
      }

      const staff = await CleaningStaff.findByPk(pass.cleaning_staff_id, { transaction: t });

      return {
        direction: "OUT",
        attendance,
        staff,
        pass,
        workedMinutes,
        remaining: 0,
      };
    });

    const staffName = result.staff?.name || null;

    return res.status(200).json({
      success: true,
      scan_type: result.direction,
      message:
        result.direction === "IN"
          ? "Entry recorded successfully"
          : "Exit recorded successfully",
      cleaning_staff_id: result.attendance.cleaning_staff_id,
      staff_name: staffName,
      pass_code: result.pass.pass_code,
      attendance_date: today,
      attendance: result.attendance,
      worked_minutes: result.direction === "OUT" ? result.workedMinutes : null,
      scans_used: result.attendance.scan_count,
      max_scans_per_day: MAX_SCANS_PER_DAY,
      scans_remaining: result.remaining,
    });
  } catch (err) {
    if (err.httpStatus) {
      return res.status(err.httpStatus).json(err.body);
    }
    console.error("[cleaningStaff:scan]", err);
    return res.status(500).json({ message: err.message });
  }
};

/* ───────────────────────────────────────────────────────────────────────────
   4. ATTENDANCE (admin view + manual correction)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/cleaning-staff/attendance
 * Society-wide attendance for a date, or a date range. Defaults to today.
 */
const getCleaningStaffAttendance = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const { date, from, to } = req.query;
  const today = getTodayIST();

  const where = { society_id: societyId };

  if (date) {
    if (!isValidISODate(String(date))) {
      return res.status(400).json({ message: "date must be a valid date (YYYY-MM-DD)" });
    }
    where.attendance_date = String(date);
  } else if (from || to) {
    if (from && !isValidISODate(String(from))) {
      return res.status(400).json({ message: "from must be a valid date (YYYY-MM-DD)" });
    }
    if (to && !isValidISODate(String(to))) {
      return res.status(400).json({ message: "to must be a valid date (YYYY-MM-DD)" });
    }
    where.attendance_date = {};
    if (from) where.attendance_date[Op.gte] = String(from);
    if (to) where.attendance_date[Op.lte] = String(to);
  } else {
    where.attendance_date = today;
  }

  const rows = await CleaningStaffAttendance.findAll({
    where,
    include: [
      {
        model: CleaningStaff,
        as: "cleaningStaff",
        attributes: ["id", "name", "phone", "designation"],
        required: false,
      },
    ],
    order: [["attendance_date", "DESC"]],
  });

  return res.status(200).json({ success: true, data: rows });
};

/**
 * GET /api/cleaning-staff/:id/attendance
 * One staff member's attendance history.
 */
const getStaffAttendance = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const staff = await findScopedStaff(req.params.id, societyId);
  if (!staff) {
    return res.status(404).json({ message: "Cleaning staff member not found" });
  }

  const { from, to } = req.query;
  const where = { cleaning_staff_id: staff.id, society_id: societyId };

  if (from || to) {
    if (from && !isValidISODate(String(from))) {
      return res.status(400).json({ message: "from must be a valid date (YYYY-MM-DD)" });
    }
    if (to && !isValidISODate(String(to))) {
      return res.status(400).json({ message: "to must be a valid date (YYYY-MM-DD)" });
    }
    where.attendance_date = {};
    if (from) where.attendance_date[Op.gte] = String(from);
    if (to) where.attendance_date[Op.lte] = String(to);
  }

  const rows = await CleaningStaffAttendance.findAll({
    where,
    order: [["attendance_date", "DESC"]],
  });

  return res.status(200).json({ success: true, data: rows });
};

/**
 * PATCH /api/cleaning-staff/attendance/:attendanceId
 *
 * Manual correction. A note is mandatory so every override is explainable, and
 * the row is flagged is_manual with the editor's id for audit.
 */
const updateCleaningStaffAttendance = async (req, res) => {
  const societyId = requireSocietyContext(req, res);
  if (!societyId) return;

  const record = await CleaningStaffAttendance.findOne({
    where: { id: req.params.attendanceId, society_id: societyId },
  });
  if (!record) {
    return res.status(404).json({ message: "Attendance record not found" });
  }

  const { check_in, check_out, notes } = req.body || {};

  const cleanNotes = notes ? sanitizeText(String(notes)) : "";
  if (!cleanNotes) {
    return res.status(400).json({
      message: "A note is required when manually correcting attendance.",
      code: "NOTES_REQUIRED",
    });
  }

  const updates = {};

  if (check_in !== undefined) {
    if (check_in === null || check_in === "") {
      updates.check_in = null;
    } else {
      const d = new Date(check_in);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: "check_in must be a valid timestamp" });
      }
      updates.check_in = d;
    }
  }

  if (check_out !== undefined) {
    if (check_out === null || check_out === "") {
      updates.check_out = null;
    } else {
      const d = new Date(check_out);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: "check_out must be a valid timestamp" });
      }
      updates.check_out = d;
    }
  }

  const nextIn = updates.check_in !== undefined ? updates.check_in : record.check_in;
  const nextOut = updates.check_out !== undefined ? updates.check_out : record.check_out;

  if (nextIn && nextOut && new Date(nextOut) < new Date(nextIn)) {
    return res.status(400).json({ message: "check_out must be after check_in" });
  }

  /* Recompute worked_minutes so a manual edit never leaves a stale total. */
  updates.worked_minutes = calculateWorkedMinutes(nextIn, nextOut);
  updates.is_manual = true;
  updates.manually_edited_by = req.user.id;
  updates.notes = cleanNotes;

  await record.update(updates);

  return res.status(200).json({
    success: true,
    message: "Attendance corrected",
    data: record,
  });
};

module.exports = {
  getCleaningStaff,
  getCleaningStaffById,
  createCleaningStaff,
  updateCleaningStaff,
  updateCleaningStaffStatus,
  deleteCleaningStaffNotAllowed,

  createCleaningStaffPass,
  getCleaningStaffPasses,
  revokeCleaningStaffPass,

  scanCleaningStaffPass,

  getCleaningStaffAttendance,
  getStaffAttendance,
  updateCleaningStaffAttendance,

  /* exported for tests */
  handle,
};