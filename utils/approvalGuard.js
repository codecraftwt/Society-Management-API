/**
 * Centralized approval-state rules shared by the flat/household assignment
 * endpoints and the login flow.
 *
 * Why this is its own module: "who is allowed to occupy a flat" and "what do we
 * tell a rejected resident at login" were previously duplicated (and silently
 * missing) across five controllers. Keeping the rule in one place means a
 * future change to the approval model cannot drift between endpoints.
 */

const User = require("../models/User");

const REJECTED = "REJECTED";

/**
 * Narrow guard: is this user a REJECTED registration?
 *
 * Used by endpoints that grant *privileges* rather than homes - promoting to
 * committee and appointing as accountant. Those are separate from flat
 * assignment, but the rule is identical: a rejected registration must be
 * re-approved by an admin before it can hold any role.
 *
 * Split out from ensureAssignable so the "no flat" rule and the "no role" rule
 * can be applied independently where an endpoint allows one but not the other.
 *
 * @param {number|string} userId
 * @returns {Promise<{ok: true, user: object} | {ok: false, status: number, payload: object}>}
 */
const ensureNotRejected = async (userId) => {
  if (!userId) {
    return {
      ok: false,
      status: 400,
      payload: { code: "RESIDENT_ID_REQUIRED", message: "Resident ID is missing" },
    };
  }

  const user = await User.findByPk(userId, {
    attributes: ["id", "name", "email", "approval_status", "status", "society_id", "rejection_reason"],
  });

  if (!user) {
    return {
      ok: false,
      status: 404,
      payload: { code: "RESIDENT_NOT_FOUND", message: "Resident not found" },
    };
  }

  if (String(user.approval_status || "").toUpperCase() === REJECTED) {
    return {
      ok: false,
      status: 409,
      payload: {
        code: "RESIDENT_APPROVAL_REJECTED",
        message:
          "This resident's registration was rejected, so no role or flat can be assigned. " +
          "Approve the registration first, then try again.",
        rejection_reason: user.rejection_reason || null,
      },
    };
  }

  return { ok: true, user };
};

/**
 * Guard for any endpoint that links a user to a flat.
 *
 * PENDING is deliberately ALLOWED. The owner-nomination flow
 * (userControllers.addTenantByOwner) intentionally links a nominated tenant to
 * a flat *before* the admin reviews them, so blocking PENDING would break that
 * legitimate path. REJECTED is the only state that must never be assignable.
 *
 * @param {number|string} userId
 * @returns {Promise<{ok: true, user: object} | {ok: false, status: number, payload: object}>}
 */
const ensureAssignable = async (userId) => {
  const result = await ensureNotRejected(userId);
  if (result.ok) return result;
  if (result.payload && result.payload.code === "RESIDENT_APPROVAL_REJECTED") {
    result.payload.message =
      "This resident's registration was rejected, so a flat cannot be assigned. " +
      "Approve the registration first, then assign the flat.";
  }
  return result;
};

/**
 * Best-effort "who should this resident contact?" lookup for rejection messages.
 *
 * Uses only the indexed `role` column rather than a JSON `roles` query, because
 * the project has no `Op.contains` precedent on this MySQL setup. Committee
 * members are included as a fallback since they are approved approvers in this
 * codebase (see the role allowlist in adminControllers). Returns null when no
 * staff record is found, and callers must degrade gracefully to a generic
 * "contact your society admin" line.
 *
 * @param {number|string|null} societyId
 * @returns {Promise<{name: string, email: string|null, phone: string|null, role: string}|null>}
 */
const resolveSocietyAdminContact = async (societyId) => {
  if (!societyId) return null;

  try {
    const staff = await User.findAll({
      where: { society_id: societyId, role: ["SOCIETY_ADMIN", "COMMITTEE_MEMBER"] },
      attributes: ["id", "name", "email", "phone", "role"],
      order: [["id", "ASC"]],
      limit: 20,
    });

    if (!staff.length) return null;

    const pick = staff.find((u) => u.role === "SOCIETY_ADMIN") || staff[0];
    return {
      name: pick.name || "Society Admin",
      email: pick.email || null,
      phone: pick.phone || null,
      role: pick.role,
    };
  } catch (err) {
    // Never let a contact lookup break the caller's response.
    console.error("[approvalGuard] admin contact lookup failed:", err.message);
    return null;
  }
};

module.exports = { ensureAssignable, ensureNotRejected, resolveSocietyAdminContact, REJECTED };
