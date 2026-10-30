const User = require("../models/User");
const Society = require("../models/Society");
const Block = require("../models/Block");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const HouseHoldMember = require("../models/HouseHoldMember");
const OtpVerification = require("../models/OtpVerification");
const AccountantAssignment = require("../models/AccountantAssignment");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const UserDocuments = require("../models/UserDocuments");
const { resolveSocietyAdminContact } = require("../utils/approvalGuard");
const notificationService = require("../services/notificationService");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Op } = require("sequelize");
const transporter = require("../utils/mailer");
const { fetchEffectivePermissions } = require("./permissionController");
const {
  sanitizeText,
  isEmpty,
  isValidEmail,
  isValidMobile,
  isValidPersonName,
} = require("../utils/validation");

/* =====
    HELPERS
    ===== */
async function fetchUserSocietiesList(userId) {
  try {
    const userSocieties = await UserSociety.findAll({
      where: { user_id: userId, membership_status: "ACTIVE" },
      include: [
        {
          model: Society,
          as: "society",
          attributes: ["id", "name", "address", "logo_url"],
        },
        {
          model: UserSocietyRole,
          as: "societyRoles",
          attributes: ["role"],
        },
      ],
      order: [["is_default", "DESC"], ["created_at", "ASC"]],
    });

    if (userSocieties && userSocieties.length > 0) {
      const userRecord = await User.findByPk(userId, { attributes: ["id", "society_id", "role", "roles"] });
      const userRoles = userRecord ? resolveUserRoles(userRecord) : [];
      const isSocAdmin = userRoles.includes("SOCIETY_ADMIN");
      const activeAccountantAssignments = await AccountantAssignment.findAll({
        where: { user_id: userId, status: "ACTIVE" },
        attributes: ["society_id", "is_society_resident"],
      });
      const accountantSocietyIds = new Map(
        activeAccountantAssignments.map((assignment) => [
          String(assignment.society_id),
          assignment.is_society_resident === true,
        ])
      );

      const list = [];
      for (const us of userSocieties) {
        let roles = (us.societyRoles || []).map((r) => r.role);
        if (accountantSocietyIds.has(String(us.society_id)) && !roles.includes("ACCOUNTANT")) {
          roles.push("ACCOUNTANT");
        }
        // Residence is society-specific. Do not rely only on the global
        // users.roles JSON or UserSocietyRole rows; an active flat/household
        // membership is the source of truth for the Resident panel.
        if (userRecord && await isUserResidentOfSociety(userRecord, us.society_id) && !roles.includes("RESIDENT")) {
          roles.push("RESIDENT");
        }
        if (isSocAdmin && String(userRecord?.society_id) === String(us.society_id) && !roles.includes("SOCIETY_ADMIN")) {
          roles.unshift("SOCIETY_ADMIN");
        }
        if (roles.includes("SOCIETY_ADMIN") && roles.includes("RESIDENT")) {
          const isResident = await isUserResidentOfSociety(userRecord, us.society_id);
          if (!isResident) {
            roles = roles.filter((r) => r !== "RESIDENT");
          }
        }
        list.push({
          id: us.society_id,
          name: us.society?.name || `Society #${us.society_id}`,
          address: us.society?.address || null,
          logo_url: us.society?.logo_url || null,
          roles: roles.length > 0 ? roles : (isSocAdmin ? ["SOCIETY_ADMIN"] : (us.resident_type ? [us.resident_type] : ["RESIDENT"])),
          resident_type: us.resident_type || null,
          is_default: Boolean(us.is_default),
          membership_status: us.membership_status,
        });
      }
      return list;
    }

    // Fallback if no user_societies row yet:
    const user = await User.findByPk(userId, {
      include: [{ model: Society, attributes: ["id", "name", "address", "logo_url"] }],
    });
    if (user && user.society_id) {
      let roles = resolveUserRoles(user);
      if (roles.includes("SOCIETY_ADMIN") && roles.includes("RESIDENT")) {
        const isResident = await isUserResidentOfSociety(user, user.society_id);
        if (!isResident) {
          roles = roles.filter((r) => r !== "RESIDENT");
        }
      }
      return [
        {
          id: user.society_id,
          name: user.Society?.name || "My Society",
          address: user.Society?.address || null,
          logo_url: user.Society?.logo_url || null,
          roles,
          resident_type: user.resident_type || null,
          is_default: true,
          membership_status: "ACTIVE",
        },
      ];
    }
    return [];
  } catch (err) {
    console.error("fetchUserSocietiesList error:", err);
    return [];
  }
}

async function isUserResidentOfSociety(user, societyId = null) {
  if (!user || !user.id) return false;
  const targetSocId = societyId || user.society_id;
  try {
    const blockInclude = targetSocId
      ? [{ model: Block, where: { society_id: targetSocId }, required: true }]
      : [{ model: Block, required: true }];

    // 1. Check direct flat assignment (Flat.resident_id)
    const directFlat = await Flat.findOne({
      where: { resident_id: user.id },
      include: blockInclude,
    });
    if (directFlat) return true;

    // 2. Check active flat membership (not moved out)
    const membership = await FlatMembership.findOne({
      where: {
        user_id: user.id,
        is_current: true,
        move_out_date: null,
      },
      include: [{
        model: Flat,
        required: true,
        include: blockInclude,
      }],
    });
    if (membership) return true;

    // 3. Check household member
    const household = await HouseHoldMember.findOne({
      where: { user_id: user.id },
      include: [{
        model: Flat,
        required: true,
        include: blockInclude,
      }],
    });
    if (household) return true;

    // 4. Check active accountant assignment marked as society resident
    if (targetSocId) {
      const assignment = await AccountantAssignment.findOne({
        where: {
          user_id: user.id,
          society_id: targetSocId,
          status: "ACTIVE",
          is_society_resident: true,
        },
      });
      if (assignment) return true;
    }

    return false;
  } catch (err) {
    return false;
  }
}

/* Resolve a user's effective role list. */
function resolveUserRoles(user) {
  let storedRoles = user?.roles;
  if (typeof storedRoles === "string") {
    try { storedRoles = JSON.parse(storedRoles); } catch (e) { storedRoles = []; }
  }
  const roles = Array.isArray(storedRoles) && storedRoles.length > 0
    ? storedRoles.map((r) => String(r).toUpperCase())
    : [];
  const add = (r) => {
    const normalized = r ? String(r).toUpperCase() : "";
    if (normalized && !roles.includes(normalized)) roles.push(normalized);
  };

  add(user.role);
  if (roles.includes("COMMITTEE_MEMBER") || roles.includes("COMMITTEE")) {
    add("COMMITTEE_MEMBER");
  }

  return roles;
}

/* Roles that only a genuine member of the society holds. */
const SOCIETY_MEMBER_ROLES = [
  "RESIDENT",
  "SOCIETY_ADMIN",
  "FAMILY_MEMBER",
  "COMMITTEE_MEMBER",
  "COMMITTEE",
  "GUARD",
  "SUPER_ADMIN",
];

function isOutsiderAccountant(user) {
  let storedRoles = user?.roles;
  if (typeof storedRoles === "string") {
    try { storedRoles = JSON.parse(storedRoles); } catch (e) { storedRoles = []; }
  }
  const declared = [
    ...(Array.isArray(storedRoles) && storedRoles.length ? storedRoles : []),
    user.role,
  ].filter(Boolean).map((r) => String(r).toUpperCase());

  const hasAccountant = declared.some((r) => r === "ACCOUNTANT");
  const hasSocietyRole = declared.some((r) => SOCIETY_MEMBER_ROLES.includes(r));
  return hasAccountant && !hasSocietyRole;
}

async function getAvailablePanels(user) {
  const roles = resolveUserRoles(user);
  const panels = [];

  if (roles.includes("SUPER_ADMIN")) panels.push("SUPER_ADMIN");
  if (roles.includes("SOCIETY_ADMIN")) panels.push("SOCIETY_ADMIN");
  if (roles.includes("COMMITTEE_MEMBER")) panels.push("COMMITTEE_MEMBER");
  if (roles.includes("RESIDENT")) panels.push("RESIDENT");
  if (roles.includes("FAMILY_MEMBER")) panels.push("FAMILY_MEMBER");
  if (roles.includes("GUARD")) panels.push("GUARD");

  // An admin/committee account can become a resident after a flat is
  // assigned, even when the legacy users.roles array was never updated.
  if ((roles.includes("SOCIETY_ADMIN") || roles.includes("COMMITTEE_MEMBER")) && !panels.includes("RESIDENT")) {
    if (await isUserResidentOfSociety(user, user.society_id)) panels.push("RESIDENT");
  }

  // If user has SOCIETY_ADMIN or COMMITTEE_MEMBER, check if they are genuinely a resident of the society.
  // If not, do NOT give them the RESIDENT panel!
  if ((panels.includes("SOCIETY_ADMIN") || panels.includes("COMMITTEE_MEMBER")) && panels.includes("RESIDENT")) {
    const isResident = await isUserResidentOfSociety(user, user.society_id);
    if (!isResident) {
      const idx = panels.indexOf("RESIDENT");
      if (idx !== -1) panels.splice(idx, 1);
    }
  }

  // Accountant appointments are society-scoped and may exist even when the
  // legacy users.roles JSON was not updated. Resolve the active assignment for
  // the currently selected society before deciding which panels to expose.
  const accountantAssignment = user?.id && user?.society_id
    ? await AccountantAssignment.findOne({
        where: { user_id: user.id, society_id: user.society_id, status: "ACTIVE" },
        attributes: ["society_id", "is_society_resident"],
      })
    : null;
  const hasAccountantPanel = roles.includes("ACCOUNTANT") || Boolean(accountantAssignment) || user.role === "ACCOUNTANT";

  if (hasAccountantPanel) {
    const assignment = accountantAssignment || await AccountantAssignment.findOne({
      where: { user_id: user.id, status: "ACTIVE" },
      attributes: ["society_id", "is_society_resident"],
    });
    if (assignment || user.role === "ACCOUNTANT") {
      if (!panels.includes("ACCOUNTANT")) panels.push("ACCOUNTANT");

      // An accountant can also be a resident when their active assignment
      // identifies them as society-resident. Include the Resident panel so
      // the client can obtain a valid Resident-scoped token instead of
      // repeatedly receiving a 403 Access Restricted response.
      const isResident = (assignment?.is_society_resident === true) || await isUserResidentOfSociety(user, user.society_id);
      if (isResident && !panels.includes("RESIDENT")) {
        panels.push("RESIDENT");
      }

      if (isOutsiderAccountant(user)) {
        if (!isResident) {
          const idx = panels.indexOf("RESIDENT");
          if (idx !== -1) panels.splice(idx, 1);
        }
      }
    }
  }

  return panels.length > 0 ? panels : [user.role];
}

/* Exposed to the clients so they never have to infer residency from the roles
   array (which may contain legacy RESIDENT for admins or accountants). */
async function getResidencyFlags(user, availablePanels) {
  const isResident = await isUserResidentOfSociety(user);
  const isOutsider = isOutsiderAccountant(user);
  return {
    is_society_resident: isResident,
    can_switch_to_resident: availablePanels.includes("RESIDENT") && isResident,
    ...(isOutsider ? { is_accountant_outsider: true } : {}),
  };
}
function generateOtp() {
  // Real random 6-digit OTP for all environments.
  // In test mode, keep it deterministic so the test suite can log in.
  if (process.env.NODE_ENV === "test") return "123456";
  return crypto.randomInt(100000, 999999).toString();
}

async function sendOtpEmail(toEmail, otp, userName, context = {}) {
  if (!transporter) return;
  if (process.env.NODE_ENV === "test") {
    console.log(`[Mailer] Test mode — skipping email to ${toEmail}`);
    return;
  }
  const appName = process.env.APP_NAME || "SocietyApp";
  const isSuperAdmin = String(context.role || "").toUpperCase() === "SUPER_ADMIN";
  const loginContext = isSuperAdmin
    ? "Super Admin Panel Access"
    : (context.societyName ? `Login Verification — ${context.societyName}` : "Login Verification");
  const safeContext = String(loginContext).replace(/[&<>\"]+/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));

  const istIntl = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const sentAt = istIntl.format(new Date());
  const expiresAt = istIntl.format(new Date(Date.now() + 2 * 60 * 1000));

  const digits = otp.split("").map(
    (d) => `<td align="center" style="width:44px;height:56px;padding:2px;">
      <table width="44" cellpadding="0" cellspacing="0" style="width:44px;">
        <tr>
          <td style="height:52px;width:44px;border-radius:12px;background:linear-gradient(160deg,#ffffff,#eef2ff);border:1.5px solid rgba(99,102,241,0.35);box-shadow:0 3px 8px rgba(99,102,241,0.12);font-size:30px;font-weight:800;color:#312e81;font-family:'Courier New',monospace;letter-spacing:0;text-align:center;">
            ${d}
          </td>
        </tr>
      </table>
    </td>`
  );

  await transporter.sendMail({
    from: `"${appName}" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `${loginContext} — ${appName}`,
    html: `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${appName} OTP</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg,#111936 0%,#202b5a 58%,#4f46a5 100%);border-radius:22px 22px 0 0;padding:34px 32px 30px;text-align:center;">
              <div style="display:inline-block;width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,0.16);border:1.5px solid rgba(255,255,255,0.35);line-height:62px;font-size:28px;text-align:center;margin-bottom:12px;">
                🔐
              </div>
              <div style="display:inline-block;margin:0 0 14px;padding:7px 13px;border:1px solid rgba(255,255,255,.28);border-radius:999px;color:#e7e9ff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${safeContext}</div>
              <h2 style="margin:0 0 6px;font-size:25px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;">
                Verify Your Login
              </h2>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);line-height:1.5;">
                ${safeContext}
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#ffffff;padding:32px 32px 24px;">
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
                Hi <strong style="color:#0f172a;">${userName || "there"}</strong>,
                <br/>
                 use the one-time code below to complete your sign in to <strong style="color:#4f46e5;">${appName}</strong>.
              </p>

              <p style="margin:0 0 14px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.16em;color:#64748b;text-align:center;">
                One-Time Password
              </p>

              <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 6px;">
                <tr>${digits.join("")}</tr>
              </table>

              <p style="margin:0 0 22px;font-size:13px;color:#64748b;text-align:center;">
                This secure code expires in <strong style="color:#4f46e5;">2 minutes</strong>
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:#64748b;padding:4px 0;width:90px;">Sent at</td>
                        <td style="font-size:13px;color:#0f172a;font-weight:600;padding:4px 0;">${sentAt} IST</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#64748b;padding:4px 0;width:90px;">Expires at</td>
                        <td style="font-size:13px;color:#0f172a;font-weight:600;padding:4px 0;">${expiresAt} IST</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#64748b;padding:4px 0;width:90px;">Validity</td>
                        <td style="font-size:13px;color:#059669;font-weight:600;padding:4px 0;">2 minutes</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;">
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#b45309;line-height:1.55;">
                    🛡️ &nbsp;<strong>Security tip:</strong> Do not share this OTP with anyone. Our team will never ask for it.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#0f172a;border-radius:0 0 22px 22px;padding:22px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
                If you didn't request this code, no action is needed —<br/>
                you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:11px;color:#475569;">
                &copy; ${new Date().getFullYear()} ${appName} &middot; All rights reserved
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`,
  });
}

/* =====
    JWT HELPER
    ===== */
function issueAccessToken(user, activeRole, targetSocietyId, customRoles) {
  let roles = customRoles && customRoles.length > 0 ? [...customRoles] : resolveUserRoles(user);
  if (activeRole && !roles.includes(activeRole)) {
    roles.push(activeRole);
  }

  const resolvedActiveRole = activeRole || roles[0];

  const payload = {
    id: user.id,
    roles,
    activeRole: resolvedActiveRole,
    society_id: targetSocietyId !== undefined && targetSocietyId !== null ? targetSocietyId : user.society_id,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" });

  return { token, payload };
}

/* =====
    AUTO-CLEANUP JOB
    ===== */
function startOtpCleanup() {
  const cleanup = async () => {
    try {
      const deleted = await OtpVerification.destroy({
        where: { expires_at: { [Op.lt]: new Date() } },
      });
      if (deleted > 0) {
        console.log(`[OTP Cleanup] Removed ${deleted} expired OTP record(s)`);
      }
    } catch (err) {
      console.error("[OTP Cleanup] Error:", err.message);
    }
  };

  cleanup();
  setInterval(cleanup, 60 * 1000);
  console.log("[OTP Cleanup] Auto-cleanup started (interval: 60s)");
}

exports.startOtpCleanup = startOtpCleanup;

/* =====
    POST /auth/login  — Step 1: validate credentials → send OTP
    ===== */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({
      where: { email },
      include: [{ model: Society, attributes: ["id", "name", "logo_url"] }],
    });

    if (!user) return res.status(400).json({ message: "User not found" });
    if (user.status !== "ACTIVE") {
      const appStatus = (user.approval_status || "").toUpperCase();
      // Machine-readable codes so the client can branch on account state
      // instead of pattern-matching the message text.
      if (appStatus === "PENDING") {
        return res.status(400).json({
          code: "APPROVAL_PENDING",
          message: "Your registration is pending approval by the society admin. You can log in once approved.",
        });
      }
      if (appStatus === "REJECTED") {
        // Surface the stored reason and a real contact so the client can show a
        // useful rejection screen instead of a generic "login failed" toast.
        const adminContact = await resolveSocietyAdminContact(user.society_id);
        return res.status(400).json({
          code: "APPROVAL_REJECTED",
          message: "Your registration was rejected by the society admin. Please contact the admin for more information.",
          rejection_reason: user.rejection_reason || null,
          society_name: user.Society?.name || null,
          admin_contact: adminContact
            ? { name: adminContact.name, email: adminContact.email, phone: adminContact.phone }
            : null,
        });
      }
      return res.status(400).json({
        code: "ACCOUNT_INACTIVE",
        message: "Account is inactive.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });

    // ✅ Generate OTP + clear old records in parallel
    const otp = generateOtp();
    const [otp_hash] = await Promise.all([
      bcrypt.hash(otp, 8), // ✅ rounds=8 instead of 10 (faster, still safe for short-lived OTPs)
      OtpVerification.destroy({ where: { email } }),
    ]);

    // The login context is resolved from the authenticated user's backend record.
    // This keeps society branding accurate and avoids trusting frontend role labels.
    const loginRoles = resolveUserRoles(user);
    const loginRole = loginRoles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : loginRoles[0];
    // ✅ Await the email so the client timer only starts after dispatch
    await sendOtpEmail(email, otp, user.name, {
      role: loginRole,
      societyName: user.Society?.name,
    });

    const expires_at = new Date(Date.now() + 2 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    const roles = resolveUserRoles(user);

    const tempToken = jwt.sign(
      {
        id: user.id,
        email,
        roles,
        activeRole: user.role,
        phase: "otp_pending",
      },
      process.env.JWT_SECRET,
      { expiresIn: "3m" }
    );

    const availablePanels = await getAvailablePanels(user);
    const availableSocieties = await fetchUserSocietiesList(user.id);
    const residencyFlags = await getResidencyFlags(user, availablePanels);

    return res.status(200).json({
      message: "OTP sent to your registered email address",
      tempToken,
      availablePanels,
      availableSocieties,
      ...residencyFlags,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roles,
        activeRole: user.role,
        availablePanels,
        availableSocieties,
        ...residencyFlags,
        society_id: user.society_id,
        society_name: user.Society?.name || null,
        society_logo: user.Society?.logo_url || null,
        society_logo_url: user.Society?.logo_url || null,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/verify-otp  — Step 2: verify OTP → issue real JWT
    ===== */
exports.verifyOtp = async (req, res) => {
  try {
    const { otp, tempToken } = req.body;

    if (!otp || !tempToken) {
      return res.status(400).json({ message: "OTP and session token are required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Session expired. Please login again." });
      }
      return res.status(401).json({ message: "Invalid session. Please login again." });
    }

    if (decoded.phase !== "otp_pending") {
      return res.status(401).json({ message: "Invalid session phase." });
    }

    const { email, id: userId } = decoded;

    const record = await OtpVerification.findOne({
      where: {
        email,
        used: false,
        expires_at: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (!record) {
      return res.status(400).json({
        message: "OTP has expired or is invalid. Please login again.",
      });
    }

    if (record.attempts >= 5) {
      await record.destroy();
      return res.status(429).json({
        message: "Too many failed attempts. Please login again.",
      });
    }

    const isValid = await bcrypt.compare(otp.trim(), record.otp_hash);

    if (!isValid) {
      await record.update({ attempts: record.attempts + 1 });
      const remaining = 4 - record.attempts;
      return res.status(400).json({
        message: `Incorrect OTP. ${
          remaining > 0
            ? `${remaining} attempt(s) remaining.`
            : "No attempts remaining. Please login again."
        }`,
      });
    }

    // ✅ Run DB destroy + user fetch in parallel
    const [user] = await Promise.all([
      User.findOne({
        where: { id: userId },
        include: [{ model: Society, attributes: ["id", "name", "logo_url"] }],
      }),
      record.destroy(),
    ]);

    if (!user) return res.status(404).json({ message: "User not found" });

    const availableSocieties = await fetchUserSocietiesList(user.id);
    const defaultSociety = availableSocieties.find((s) => s.is_default) || availableSocieties[0];
    const activeSocietyId = defaultSociety ? defaultSociety.id : user.society_id;
    let activeSocietyRoles = defaultSociety && defaultSociety.roles && defaultSociety.roles.length > 0
      ? defaultSociety.roles
      : resolveUserRoles(user);

    const isDirectSocAdmin = (String(user.society_id) === String(activeSocietyId) || !activeSocietyId) &&
      (user.role === "SOCIETY_ADMIN" || (Array.isArray(user.roles) && user.roles.includes("SOCIETY_ADMIN")));
    if (isDirectSocAdmin && !activeSocietyRoles.includes("SOCIETY_ADMIN")) {
      activeSocietyRoles = ["SOCIETY_ADMIN", ...activeSocietyRoles];
    }

    // Role priority for initialRole:
    // SUPER_ADMIN > SOCIETY_ADMIN > COMMITTEE_MEMBER > ACCOUNTANT > GUARD > RESIDENT > FAMILY_MEMBER
    let initialRole;
    if (activeSocietyRoles.includes("SUPER_ADMIN") || user.role === "SUPER_ADMIN") {
      initialRole = "SUPER_ADMIN";
    } else if (activeSocietyRoles.includes("SOCIETY_ADMIN") || isDirectSocAdmin) {
      initialRole = "SOCIETY_ADMIN";
    } else if (activeSocietyRoles.includes("COMMITTEE_MEMBER") || user.role === "COMMITTEE_MEMBER") {
      initialRole = "COMMITTEE_MEMBER";
    } else if (activeSocietyRoles.includes("ACCOUNTANT") || user.role === "ACCOUNTANT") {
      initialRole = "ACCOUNTANT";
    } else if (activeSocietyRoles.includes("GUARD") || user.role === "GUARD") {
      initialRole = "GUARD";
    } else if (activeSocietyRoles.includes(user.role)) {
      initialRole = user.role;
    } else {
      initialRole = activeSocietyRoles[0] || "RESIDENT";
    }

    const { token } = issueAccessToken(user, initialRole, activeSocietyId, activeSocietyRoles);
    const roles = activeSocietyRoles;
    const scopedUser = {
      ...user.toJSON(),
      society_id: activeSocietyId,
      role: initialRole,
      roles,
      resident_type: defaultSociety?.resident_type || user.resident_type,
    };
    const availablePanels = await getAvailablePanels(scopedUser);
    const residencyFlags = await getResidencyFlags(scopedUser, availablePanels);
    const dynamicPermissions = await fetchEffectivePermissions(activeSocietyId, initialRole);

    return res.status(200).json({
      message: "Login successful",
      token,
      availablePanels,
      availableSocieties,
      activeSocietyId,
      ...residencyFlags,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: initialRole,
        roles,
        activeRole: initialRole,
        availablePanels,
        availableSocieties,
        ...residencyFlags,
        dynamic_permissions: dynamicPermissions,
        permissions: dynamicPermissions,
        resident_type: scopedUser.resident_type || null,
        society_id: activeSocietyId,
        society_name: defaultSociety?.name || user.Society?.name || null,
        society_logo: defaultSociety?.logo_url || user.Society?.logo_url || null,
        society_logo_url: defaultSociety?.logo_url || user.Society?.logo_url || null,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (err) {
    console.error("OTP verify error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/resend-otp
    ===== */
exports.resendOtp = async (req, res) => {
  try {
    const { tempToken } = req.body;

    if (!tempToken) {
      return res.status(400).json({ message: "Session token is required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    if (decoded.phase !== "otp_pending") {
      return res.status(401).json({ message: "Invalid session." });
    }

    const { email, id: userId } = decoded;

    const user = await User.findByPk(userId, {
      include: [{ model: Society, attributes: ["name"] }],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Run OTP generation + DB destroy in parallel
    const otp = generateOtp();
    const [otp_hash] = await Promise.all([
      bcrypt.hash(otp, 8), // ✅ rounds=8
      OtpVerification.destroy({ where: { email } }),
    ]);

    // ✅ Await the email so the resend timer only restarts after dispatch
    const resendRoles = resolveUserRoles(user);
    await sendOtpEmail(email, otp, user.name, {
      role: resendRoles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : resendRoles[0],
      societyName: user.Society?.name,
    });

    const expires_at = new Date(Date.now() + 2 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    return res.status(200).json({ message: "OTP resent successfully" });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/send-registration-otp

    Registration OTP is emailed to the applicant's email address (never SMS'd to
    their mobile). Stores the hashed OTP against the email in otp_verifications
    and mails a short-lived code that must be verified before /auth/register runs.
    ===== */
exports.sendRegistrationOtp = async (req, res) => {
  try {
    const { email, name, phone } = req.body;

    const cleanEmail = sanitizeText(email).toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (phone && !isValidMobile(String(phone))) {
      return res
        .status(400)
        .json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }

    const { society_id } = req.body;
    // Multi-society support: if account exists, only block if already registered in the target society
    const existing = await User.findOne({ where: { email: cleanEmail } });
    if (existing && existing.status === "ACTIVE") {
      if (society_id) {
        const isMember = await UserSociety.findOne({
          where: {
            user_id: existing.id,
            society_id,
            membership_status: { [Op.ne]: "REJECTED" },
          },
        });
        if (isMember || String(existing.society_id) === String(society_id)) {
          return res.status(400).json({ message: "You are already registered in this society." });
        }
      } else {
        return res.status(400).json({ message: "An account with this email already exists. Please login." });
      }
    }

    const otp = generateOtp();
    const expires_at = new Date(Date.now() + 2 * 60 * 1000);

    // Replace any prior registration code for this email, then hash the new one.
    await OtpVerification.destroy({ where: { email: cleanEmail } });
    const otp_hash = await bcrypt.hash(otp, 8);

    await Promise.all([
      sendOtpEmail(cleanEmail, otp, sanitizeText(name) || "Resident"),
      OtpVerification.create({ email: cleanEmail, otp_hash, expires_at }),
    ]);

    return res.status(200).json({
      message: "OTP sent to your email address",
      email: cleanEmail,
      expiresIn: 120,
    });
  } catch (err) {
    console.error("Registration OTP send error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/verify-registration-otp

    Confirms the emailed code for an applicant who does not have an account yet,
    so it cannot reuse verifyOtp (which requires a real userId). On success the
    code is burned (used = true) and the client may call /auth/register.
    ===== */
exports.verifyRegistrationOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const cleanEmail = sanitizeText(email).toLowerCase();
    if (!cleanEmail || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const record = await OtpVerification.findOne({
      where: {
        email: cleanEmail,
        used: false,
        expires_at: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (!record) {
      return res
        .status(400)
        .json({ message: "OTP has expired or is invalid. Please request a new one." });
    }

    if (record.attempts >= 5) {
      await record.destroy();
      return res
        .status(429)
        .json({ message: "Too many failed attempts. Please request a new OTP." });
    }

    const isValid = await bcrypt.compare(String(otp).trim(), record.otp_hash);
    if (!isValid) {
      await record.update({ attempts: record.attempts + 1 });
      const remaining = 4 - record.attempts;
      return res.status(400).json({
        message: `Incorrect OTP. ${
          remaining > 0
            ? `${remaining} attempt(s) remaining.`
            : "No attempts remaining. Please request a new OTP."
        }`,
      });
    }

    await record.update({ used: true });

    return res.status(200).json({ message: "Email verified successfully", email: cleanEmail });
  } catch (err) {
    console.error("Registration OTP verify error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/switch-role
    ===== */
exports.switchRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: "role is required" });
    }

    const user = await User.findByPk(req.user.id, {
      include: [{ model: Society, attributes: ["name"] }],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const targetSocietyId = req.user.society_id ? parseInt(req.user.society_id, 10) : user.society_id;
    const society = targetSocietyId ? await Society.findByPk(targetSocietyId) : user.Society;

    const legacyRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role].filter(Boolean);
    const isSuperAdmin = legacyRoles.includes("SUPER_ADMIN") || (req.user.roles || []).includes("SUPER_ADMIN");

    let societyRoles = [];
    const membership = targetSocietyId ? await UserSociety.findOne({
      where: { user_id: user.id, society_id: targetSocietyId, membership_status: "ACTIVE" },
      include: [{ model: UserSocietyRole, as: "societyRoles" }],
    }) : null;

    if (membership && membership.societyRoles && membership.societyRoles.length > 0) {
      societyRoles = membership.societyRoles.map((r) => r.role);
    } else if (isSuperAdmin) {
      societyRoles = ["SUPER_ADMIN"];
    } else {
      societyRoles = resolveUserRoles(user);
    }

    const scopedUser = {
      ...user.toJSON(),
      society_id: targetSocietyId,
      role: user.role,
      roles: societyRoles,
      resident_type: membership?.resident_type || user.resident_type,
    };

    const availablePanels = await getAvailablePanels(scopedUser);

    if (!societyRoles.includes(role) && !availablePanels.includes(role)) {
      return res.status(403).json({
        message: `Role "${role}" is not assigned to your account in this society. Available: ${availablePanels.join(", ")}`,
      });
    }

    if (!availablePanels.includes(role)) {
      return res.status(403).json({
        message: `Role "${role}" is not assigned to your account. Available: ${availablePanels.join(", ")}`,
      });
    }

    if (!societyRoles.includes(role)) {
      societyRoles.push(role);
    }
    const { token } = issueAccessToken(user, role, targetSocietyId, societyRoles);
    const residencyFlags = await getResidencyFlags(scopedUser, availablePanels);
    const dynamicPermissions = await fetchEffectivePermissions(targetSocietyId, role);
    const availableSocieties = await fetchUserSocietiesList(user.id);

    return res.status(200).json({
      message: `Switched to ${role}`,
      token,
      activeSocietyId: targetSocietyId,
      availableSocieties,
      availablePanels,
      ...residencyFlags,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        roles: societyRoles,
        activeRole: role,
        availablePanels,
        availableSocieties,
        ...residencyFlags,
        dynamic_permissions: dynamicPermissions,
        permissions: dynamicPermissions,
        resident_type: scopedUser.resident_type || null,
        society_id: targetSocietyId,
        society_name: society?.name || null,
        society_logo: society?.logo_url || null,
        society_logo_url: society?.logo_url || null,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (err) {
    console.error("Switch role error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    GET /auth/societies — Get list of user's active societies
    ===== */
exports.getUserSocieties = async (req, res) => {
  try {
    const userId = req.user.id;
    const availableSocieties = await fetchUserSocietiesList(userId);
    return res.status(200).json({
      activeSocietyId: req.user.society_id,
      societies: availableSocieties,
    });
  } catch (err) {
    console.error("Get user societies error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/switch-society — Switch active society & get fresh JWT
    ===== */
exports.switchSociety = async (req, res) => {
  try {
    const userId = req.user.id;
    const { society_id, role: requestedRole } = req.body;

    if (!society_id) {
      return res.status(400).json({ message: "society_id is required" });
    }

    const targetSocietyId = parseInt(society_id, 10);
    if (isNaN(targetSocietyId)) {
      return res.status(400).json({ message: "Invalid society_id" });
    }

    const society = await Society.findByPk(targetSocietyId);
    if (!society) {
      return res.status(404).json({ message: "Society not found" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const legacyRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role].filter(Boolean);
    const isSuperAdmin = legacyRoles.includes("SUPER_ADMIN") || (req.user.roles || []).includes("SUPER_ADMIN");

    let membership = await UserSociety.findOne({
      where: { user_id: userId, society_id: targetSocietyId, membership_status: "ACTIVE" },
      include: [{ model: UserSocietyRole, as: "societyRoles" }],
    });

    if (!membership && !isSuperAdmin) {
      if (user.society_id === targetSocietyId) {
        // Allow legacy user whose society_id matches
      } else {
        return res.status(403).json({
          message: "You do not have active membership in this society",
        });
      }
    }

    let societyRoles = [];
    if (membership && membership.societyRoles && membership.societyRoles.length > 0) {
      societyRoles = membership.societyRoles.map((r) => r.role);
    } else if (isSuperAdmin) {
      societyRoles = ["SUPER_ADMIN"];
    } else {
      societyRoles = resolveUserRoles(user);
    }

    // When changing society, use requestedRole if valid, or default to RESIDENT so user lands on resident panel first
    let activeRole;
    if (requestedRole && (societyRoles.includes(requestedRole) || (requestedRole === "COMMITTEE_MEMBER" && societyRoles.includes("COMMITTEE")))) {
      activeRole = requestedRole === "COMMITTEE" ? "COMMITTEE_MEMBER" : requestedRole;
    } else if (societyRoles.includes("RESIDENT")) {
      activeRole = "RESIDENT";
    } else {
      activeRole = societyRoles[0] || user.role;
    }
    const { token } = issueAccessToken(user, activeRole, targetSocietyId, societyRoles);

    const availableSocieties = await fetchUserSocietiesList(user.id);
    const dynamicPermissions = await fetchEffectivePermissions(targetSocietyId, activeRole);

    const scopedUser = {
      ...user.toJSON(),
      society_id: targetSocietyId,
      role: activeRole,
      roles: societyRoles,
      resident_type: membership?.resident_type || user.resident_type,
    };
    const availablePanels = await getAvailablePanels(scopedUser);
    const residencyFlags = await getResidencyFlags(scopedUser, availablePanels);

    return res.status(200).json({
      message: "Switched society successfully",
      token,
      society_id: targetSocietyId,
      activeSocietyId: targetSocietyId,
      roles: societyRoles,
      availableSocieties,
      availablePanels,
      ...residencyFlags,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: activeRole,
        roles: societyRoles,
        activeRole,
        availablePanels,
        availableSocieties,
        ...residencyFlags,
        dynamic_permissions: dynamicPermissions,
        permissions: dynamicPermissions,
        resident_type: scopedUser.resident_type || null,
        society_id: targetSocietyId,
        society_name: society.name,
        society_logo: society.logo_url || null,
        society_logo_url: society.logo_url || null,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (err) {
    console.error("Switch society error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/register  — Register Resident
    ===== */
exports.registerResident = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      society_id,
      flat_id,
      occupant_count,
      vehicle_count,
      emergency_contact,
      profile_picture,
      aadhar_card,
      pan_card,
    } = req.body;

    const cleanPassword = (password || "").trim();

    if (!society_id)
      return res.status(400).json({ message: "Society is required" });

    if (!isValidPersonName(sanitizeText(name))) {
      return res.status(400).json({
        message:
          "Full name must be at least 2 characters and contain only letters, spaces, dots, apostrophes or hyphens.",
      });
    }
    if (!isValidEmail(sanitizeText(email))) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (isEmpty(cleanPassword)) {
      return res.status(400).json({ message: "Password is required." });
    }
    if (phone && !isValidMobile(phone)) {
      return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }

    const UserSociety = require("../models/UserSociety");
    const UserSocietyRole = require("../models/UserSocietyRole");

    const existing = await User.findOne({ where: { email } });

    if (existing) {
      if (
        existing.approval_status === "REJECTED" &&
        existing.status === "INACTIVE"
      ) {
        await notificationService.deleteUserNotifications(existing.id);
        await existing.destroy();
      } else {
        // Multi-society: check if already member of target society
        const existingMembership = await UserSociety.findOne({
          where: {
            user_id: existing.id,
            society_id,
            membership_status: { [Op.ne]: "REJECTED" },
          },
        });

        if (existingMembership || String(existing.society_id) === String(society_id)) {
          return res.status(400).json({ message: "User already exists in this society" });
        }

        // Verify existing password or allow existing account linkage
        const useExistingAccountFlag = req.body.use_existing_account === true || req.body.is_existing_account === true;
        const isMatch =
          useExistingAccountFlag ||
          cleanPassword === "__LINKED_EXISTING_USER__" ||
          cleanPassword === existing.password ||
          (cleanPassword && (await bcrypt.compare(cleanPassword, existing.password)));

        if (!isMatch) {
          return res.status(400).json({
            message: "An account with this email already exists in another society. Please enter your existing password to request access to this society.",
          });
        }

        const cloudinary = require("../config/cloudinary");
        if (profile_picture && profile_picture.startsWith("data:") && !existing.profile_picture) {
          try {
            const uploadPic = await cloudinary.uploader.upload(profile_picture, {
              folder: "society/avatars",
              resource_type: "image",
            });
            await existing.update({ profile_picture: uploadPic.secure_url });
          } catch (e) {
            console.warn("Existing user profile picture upload warning:", e.message);
          }
        }

        if (aadhar_card || pan_card) {
          let exAadhar = aadhar_card;
          let exPan = pan_card;
          if (aadhar_card && aadhar_card.startsWith("data:")) {
            try {
              const resA = await cloudinary.uploader.upload(aadhar_card, {
                folder: `society/user_documents/${existing.id}`,
                resource_type: "auto",
              });
              exAadhar = resA.secure_url;
            } catch (e) {
              console.warn("Existing user Aadhaar upload warning:", e.message);
            }
          }
          if (pan_card && pan_card.startsWith("data:")) {
            try {
              const resP = await cloudinary.uploader.upload(pan_card, {
                folder: `society/user_documents/${existing.id}`,
                resource_type: "auto",
              });
              exPan = resP.secure_url;
            } catch (e) {
              console.warn("Existing user PAN upload warning:", e.message);
            }
          }
          const [docs] = await UserDocuments.findOrCreate({
            where: { user_id: existing.id },
            defaults: {
              aadhar_url: exAadhar || "PENDING",
              aadhar_public_id: exAadhar ? `users/${existing.id}/aadhar` : "PENDING",
              pan_url: exPan || "PENDING",
              pan_public_id: exPan ? `users/${existing.id}/pan` : "PENDING",
            },
          });
          if (exAadhar && docs.aadhar_url === "PENDING") {
            await docs.update({ aadhar_url: exAadhar, aadhar_public_id: `users/${existing.id}/aadhar` });
          }
          if (exPan && docs.pan_url === "PENDING") {
            await docs.update({ pan_url: exPan, pan_public_id: `users/${existing.id}/pan` });
          }
        }

        const [userSoc] = await UserSociety.findOrCreate({
          where: { user_id: existing.id, society_id },
          defaults: {
            membership_status: "PENDING",
            occupant_count: occupant_count != null ? Number(occupant_count) : (existing.occupant_count != null ? Number(existing.occupant_count) : 1),
            vehicle_count: vehicle_count != null ? Number(vehicle_count) : (existing.vehicle_count != null ? Number(existing.vehicle_count) : 0),
            emergency_contact: emergency_contact || existing.emergency_contact || null,
            source: "SELF_REGISTER",
          },
        });

        await UserSocietyRole.findOrCreate({
          where: { user_society_id: userSoc.id, role: "RESIDENT" },
          defaults: { user_society_id: userSoc.id, role: "RESIDENT" },
        });

        if (flat_id) {
          const flat = await Flat.findByPk(flat_id);
          if (flat && !flat.resident_id) {
            await flat.update({ resident_id: existing.id });
          }
        }

        const admin = await User.findOne({
          where: { society_id, role: "SOCIETY_ADMIN" },
        });

        if (admin?.id) {
          await notificationService.sendNotification({
            societyId,
            receiverUserId: admin.id,
            senderUserId: existing.id,
            receiverRole: "SOCIETY_ADMIN",
            title: "New Resident Request",
            message: `${existing.name} requested to join society`,
            type: "RESIDENT_REQUEST",
            actionType: "RESIDENT_REQUEST",
            sourceEventId: `RESIDENT_REQUEST:${existing.id}:${admin.id}`,
          });
        }

        return res.status(201).json({
          message: "Registration Pending Approval",
          userId: existing.id,
          reused: true,
        });
      }
    }

    const strongPasswordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!strongPasswordRegex.test(cleanPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include 1 uppercase, 1 lowercase, 1 number, and 1 special character.",
      });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    let finalProfilePic = profile_picture || null;
    let finalAadhar = aadhar_card || null;
    let finalPan = pan_card || null;

    const cloudinary = require("../config/cloudinary");
    if (profile_picture && profile_picture.startsWith("data:")) {
      try {
        const uploadPic = await cloudinary.uploader.upload(profile_picture, {
          folder: "society/avatars",
          resource_type: "image",
        });
        finalProfilePic = uploadPic.secure_url;
      } catch (e) {
        console.warn("Profile picture upload warning:", e.message);
      }
    }

    const newUser = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: "RESIDENT",
      roles: ["RESIDENT"],
      society_id,
      status: "INACTIVE",
      approval_status: "PENDING",
      occupant_count: occupant_count != null ? Number(occupant_count) : 1,
      vehicle_count: vehicle_count != null ? Number(vehicle_count) : 0,
      emergency_contact: emergency_contact || null,
      profile_picture: finalProfilePic,
    });

    if (aadhar_card && aadhar_card.startsWith("data:")) {
      try {
        const uploadAadhar = await cloudinary.uploader.upload(aadhar_card, {
          folder: `society/user_documents/${newUser.id}`,
          resource_type: "auto",
        });
        finalAadhar = uploadAadhar.secure_url;
      } catch (e) {
        console.warn("Aadhaar upload warning:", e.message);
      }
    }

    if (pan_card && pan_card.startsWith("data:")) {
      try {
        const uploadPan = await cloudinary.uploader.upload(pan_card, {
          folder: `society/user_documents/${newUser.id}`,
          resource_type: "auto",
        });
        finalPan = uploadPan.secure_url;
      } catch (e) {
        console.warn("PAN upload warning:", e.message);
      }
    }

    if (finalAadhar || finalPan) {
      await UserDocuments.create({
        user_id: newUser.id,
        aadhar_url: finalAadhar || "PENDING",
        aadhar_public_id: finalAadhar ? `users/${newUser.id}/aadhar` : "PENDING",
        pan_url: finalPan || "PENDING",
        pan_public_id: finalPan ? `users/${newUser.id}/pan` : "PENDING",
      }).catch((e) => console.warn("UserDocuments create warning:", e.message));
    }

    const [userSoc] = await UserSociety.findOrCreate({
      where: { user_id: newUser.id, society_id },
      defaults: {
        membership_status: "PENDING",
        occupant_count: occupant_count != null ? Number(occupant_count) : 1,
        vehicle_count: vehicle_count != null ? Number(vehicle_count) : 0,
        emergency_contact: emergency_contact || null,
        source: "SELF_REGISTER",
      },
    });

    await UserSocietyRole.findOrCreate({
      where: { user_society_id: userSoc.id, role: "RESIDENT" },
      defaults: { user_society_id: userSoc.id, role: "RESIDENT" },
    });

    // ✅ Run flat update + household lookup in parallel
    await Promise.all([
      flat_id
        ? Flat.findByPk(flat_id).then((flat) => {
            if (flat && !flat.resident_id)
              return flat.update({ resident_id: newUser.id });
          })
        : Promise.resolve(),
      phone
        ? HouseHoldMember.findOne({ where: { phone } }).then((rec) => {
            if (rec) return rec.update({ user_id: newUser.id });
          })
        : Promise.resolve(),
    ]);

    const admin = await User.findOne({
      where: { society_id, role: "SOCIETY_ADMIN" },
    });

    if (admin?.id) {
      await notificationService.sendNotification({
        societyId: newUser.society_id || society_id,
        receiverUserId: admin.id,
        senderUserId: newUser.id || null,
        receiverRole: "SOCIETY_ADMIN",
        title: "New Resident Request",
        message: `${name} requested to join society`,
        type: "RESIDENT_REQUEST",
        actionType: "RESIDENT_REQUEST",
        sourceEventId: `RESIDENT_REQUEST:${newUser.id || name}:${admin.id}`,
      });
    }

    return res.status(201).json({
      message: "Registration Pending Approval",
      userId: newUser.id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    GET /auth/approval-status/:id
    ===== */
exports.checkApprovalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);
 
    if (!user) return res.status(404).json({ message: "User not found" });
 
    /* Safety net — if approved but status wasn't set ACTIVE yet, fix it */
    if (user.approval_status === "APPROVED" && user.status !== "ACTIVE") {
      user.status = "ACTIVE";
      await user.save();
    }
 
    return res.json({
      approval_status:  user.approval_status,
      rejection_reason: user.rejection_reason || null,  // ✅ NEW: send reason
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* =====
    GET or POST /auth/check-email — Public check for registration
   ===== */
exports.checkEmailAvailability = async (req, res) => {
  try {
    const email = (req.query.email || req.body.email || "").trim().toLowerCase();
    const societyId = req.query.society_id || req.body.society_id;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const existingUser = await User.findOne({
      where: { email },
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "profile_picture",
        "society_id",
        "status",
        "approval_status",
        "occupant_count",
        "vehicle_count",
        "emergency_contact",
      ],
    });

    if (!existingUser) {
      return res.status(200).json({
        exists: false,
        message: "Email is available. New resident account can be created.",
      });
    }

    let isMember = false;
    if (societyId) {
      const membership = await UserSociety.findOne({
        where: {
          user_id: existingUser.id,
          society_id: societyId,
          membership_status: { [Op.ne]: "REJECTED" },
        },
      });
      if (membership || String(existingUser.society_id) === String(societyId)) {
        isMember = true;
      }
    }

    const docs = await UserDocuments.findOne({
      where: { user_id: existingUser.id },
      attributes: ["aadhar_url", "pan_url"],
    });

    const userPayload = {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email,
      phone: existingUser.phone,
      profile_picture: existingUser.profile_picture,
      occupant_count: existingUser.occupant_count != null ? Number(existingUser.occupant_count) : 1,
      vehicle_count: existingUser.vehicle_count != null ? Number(existingUser.vehicle_count) : 0,
      emergency_contact: existingUser.emergency_contact || null,
      documents: docs ? {
        aadhar_url: docs.aadhar_url,
        pan_url: docs.pan_url,
      } : null,
    };

    if (isMember) {
      return res.status(200).json({
        exists: true,
        alreadyMember: true,
        message: "You are already registered in this society.",
        user: userPayload,
      });
    }

    return res.status(200).json({
      exists: true,
      alreadyMember: false,
      message: "An existing account was found. You can link this society using your existing password without re-uploading documents.",
      user: userPayload,
    });
  } catch (err) {
    console.error("[checkEmailAvailability]", err);
    return res.status(500).json({ message: err.message });
  }
};
