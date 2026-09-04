const User = require("../models/User");
const Society = require("../models/Society");
const Flat = require("../models/Flat");
const Notification = require("../models/Notification");
const HouseHoldMember = require("../models/HouseHoldMember");
const OtpVerification = require("../models/OtpVerification");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Op } = require("sequelize");
const transporter = require("../utils/mailer");

/* =====
    HELPERS
    ===== */
function generateOtp() {
  // Real random 6-digit OTP for all environments.
  // In test mode, keep it deterministic so the test suite can log in.
  if (process.env.NODE_ENV === "test") return "123456";
  return crypto.randomInt(100000, 999999).toString();
}

async function sendOtpEmail(toEmail, otp, userName) {
  if (!transporter) return;
  if (process.env.NODE_ENV === "test") {
    console.log(`[Mailer] Test mode — skipping email to ${toEmail}`);
    return;
  }
  const appName = process.env.APP_NAME || "SocietyApp";

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
    subject: `${otp} is your ${appName} login OTP`,
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
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 45%,#8b5cf6 100%);border-radius:22px 22px 0 0;padding:30px 32px 26px;text-align:center;">
              <div style="display:inline-block;width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,0.16);border:1.5px solid rgba(255,255,255,0.35);line-height:62px;font-size:28px;text-align:center;margin-bottom:12px;">
                🔐
              </div>
              <h2 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">
                Verify Your Login
              </h2>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);line-height:1.5;">
                One more step to get you signed in
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#ffffff;padding:32px 32px 24px;">
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.65;">
                Hi <strong style="color:#0f172a;">${userName || "there"}</strong>,
                <br/>
                use the one-time code below to complete your sign in to <strong style="color:#4f46e5;">${appName}</strong>.
              </p>

              <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#94a3b8;text-align:center;">
                One-Time Password
              </p>

              <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 6px;">
                <tr>${digits.join("")}</tr>
              </table>

              <p style="margin:0 0 22px;font-size:12px;color:#94a3b8;text-align:center;">
                This code expires in <strong style="color:#6366f1;">2 minutes</strong>
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
function issueAccessToken(user, activeRole) {
  let roles = user.roles;

  if (!roles || roles.length === 0) {
    roles = [user.role];
    if (user.role === "SOCIETY_ADMIN") roles.push("RESIDENT");
  }

  const resolvedActiveRole = roles.includes(activeRole) ? activeRole : roles[0];

  const payload = {
    id: user.id,
    roles,
    activeRole: resolvedActiveRole,
    society_id: user.society_id,
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
      include: [{ model: Society, attributes: ["id", "name"] }],
    });

    if (!user) return res.status(400).json({ message: "User not found" });
    if (user.status !== "ACTIVE")
      return res.status(400).json({ message: "Account is inactive." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });

    // ✅ Generate OTP + clear old records in parallel
    const otp = generateOtp();
    const [otp_hash] = await Promise.all([
      bcrypt.hash(otp, 8), // ✅ rounds=8 instead of 10 (faster, still safe for short-lived OTPs)
      OtpVerification.destroy({ where: { email } }),
    ]);

    // ✅ Await the email so the client timer only starts after dispatch
    await sendOtpEmail(email, otp, user.name);

    const expires_at = new Date(Date.now() + 2 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    let roles = user.roles;
    if (!roles || roles.length === 0) {
      roles = [user.role];
      if (user.role === "SOCIETY_ADMIN") roles.push("RESIDENT");
    }

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

    return res.status(200).json({
      message: "OTP sent to your registered email address",
      tempToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roles,
        activeRole: user.role,
        society_id: user.society_id,
        society_name: user.Society?.name || null,
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
        include: [{ model: Society, attributes: ["id", "name"] }],
      }),
      record.destroy(),
    ]);

    if (!user) return res.status(404).json({ message: "User not found" });

    const { token } = issueAccessToken(user, user.role);
    const roles = user.roles ?? [user.role];

    // return res.status(200).json({
    //   message: "Login successful",
    //   token,
    //   user: {
    //     id: user.id,
    //     name: user.name,
    //     email: user.email,
    //     role: user.role,
    //     roles,
    //     activeRole: user.role,
    //     society_id: user.society_id,
    //     society_name: user.Society?.name || null,
    //   },
    // });
    return res.status(200).json({
  message: "Login successful",
  token,
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roles,
    activeRole: user.role,
    resident_type: user.resident_type || null,  // ✅ ADD THIS LINE
    society_id: user.society_id,
    society_name: user.Society?.name || null,
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

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Run OTP generation + DB destroy in parallel
    const otp = generateOtp();
    const [otp_hash] = await Promise.all([
      bcrypt.hash(otp, 8), // ✅ rounds=8
      OtpVerification.destroy({ where: { email } }),
    ]);

    // ✅ Await the email so the resend timer only restarts after dispatch
    await sendOtpEmail(email, otp, user.name);

    const expires_at = new Date(Date.now() + 2 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    return res.status(200).json({ message: "OTP resent successfully" });
  } catch (err) {
    console.error("Resend OTP error:", err);
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

    const { roles, id } = req.user;

    if (!roles || !roles.includes(role)) {
      return res.status(403).json({
        message: `Role "${role}" is not assigned to your account. Available: ${(roles || []).join(", ")}`,
      });
    }

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { token } = issueAccessToken(user, role);

    // return res.status(200).json({
    //   message: `Switched to ${role}`,
    //   token,
    //   user: {
    //     id: user.id,
    //     name: user.name,
    //     email: user.email,
    //     role: user.role,
    //     roles,
    //     activeRole: role,
    //     society_id: user.society_id,
    //   },
    // });
    return res.status(200).json({
  message: `Switched to ${role}`,
  token,
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roles,
    activeRole: role,
    resident_type: user.resident_type || null,  // ✅ ADD THIS LINE
    society_id: user.society_id,
  },
});
  } catch (err) {
    console.error("Switch role error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =====
    POST /auth/register  — Register Resident
    ===== */
exports.registerResident = async (req, res) => {
  try {
    const { name, email, phone, password, society_id, flat_id } = req.body;

    const cleanPassword = (password || "").trim();

    if (!society_id)
      return res.status(400).json({ message: "Society is required" });

    const existing = await User.findOne({ where: { email } });

    if (existing) {
      if (
        existing.approval_status === "REJECTED" &&
        existing.status === "INACTIVE"
      ) {
        await Notification.destroy({ where: { user_id: existing.id } });
        await existing.destroy();
      } else {
        return res.status(400).json({ message: "User already exists" });
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
      const notification = await Notification.create({
        title: "New Resident Request",
        message: `${name} requested to join society`,
        type: "RESIDENT_REQUEST",
        society_id: newUser.society_id || null,
        user_id: newUser.id || null,
        receiver_role: "SOCIETY_ADMIN",
        receiver_user_id: admin.id || null,
      });

      if (global.io) {
        global.io.to(`user_${admin.id}`).emit("new_notification", notification);
      }
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