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
  return "123456";
  // return crypto.randomInt(100000, 999999).toString();
}

async function sendOtpEmail(toEmail, otp, userName) {
  if (!transporter) return;
  const appName = process.env.APP_NAME || "SocietyApp";

  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const sentAt =
    istNow.toISOString().replace("T", " ").substring(0, 16) + " IST";
  const expiresAt =
    new Date(istNow.getTime() + 2 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .substring(0, 16) + " IST";

  await transporter.sendMail({
    from: `"${appName}" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `${otp} is your ${appName} login OTP`,
    html: `
  <!DOCTYPE html>
  <html lang="en">
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr><td style="height:4px;background:linear-gradient(90deg,#3b82f6,#6366f1,#8b5cf6);"></td></tr>
          <tr><td style="padding:36px 36px 28px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1.5px solid rgba(59,130,246,0.3);line-height:64px;font-size:28px;text-align:center;">
                🔐
              </div>
            </div>
            <h2 style="margin:0 0 8px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
              Verify Your Login
            </h2>
            <p style="margin:0 0 24px;text-align:center;color:#64748b;font-size:14px;line-height:1.6;">
              Hi <strong>${userName || "there"}</strong>, use the one-time code below to sign in to <strong>${appName}</strong>.
            </p>
            <div style="background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1.5px solid rgba(99,102,241,0.25);border-radius:16px;padding:28px 24px;text-align:center;margin-bottom:24px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">
                One-Time Password
              </p>
              <p style="margin:0;font-size:44px;font-weight:800;letter-spacing:0.22em;color:#1e40af;font-family:'Courier New',monospace;">
                ${otp}
              </p>
            </div>
            <div style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:10px;padding:12px 16px;margin-bottom:20px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                Sent at: <strong>${sentAt}</strong><br/>
                Expires at: <strong>${expiresAt}</strong><br/>
                Do not share this OTP with anyone.
              </p>
            </div>
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
              If you did not attempt to log in, please ignore this email.
            </p>
          </td></tr>
          <tr><td style="padding:16px 36px;border-top:1px solid #f1f5f9;text-align:center;">
            <p style="margin:0;font-size:11px;color:#cbd5e1;">
              &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
            </p>
          </td></tr>
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

    // ✅ Run OTP generation + DB ops in parallel
    const otp = generateOtp();
    const [otp_hash] = await Promise.all([
      bcrypt.hash(otp, 8), // ✅ rounds=8 instead of 10 (faster, still safe for short-lived OTPs)
      OtpVerification.destroy({ where: { email } }),
    ]);

    const expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    // ✅ Fire-and-forget: don't await email — respond to client immediately
    sendOtpEmail(email, otp, user.name).catch((err) =>
      console.error("[Mailer] OTP email failed:", err.message)
    );

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

    const expires_at = new Date(Date.now() + 2 * 60 * 1000);
    await OtpVerification.create({ email, otp_hash, expires_at });

    // ✅ Fire-and-forget
    sendOtpEmail(email, otp, user.name).catch((err) =>
      console.error("[Mailer] Resend OTP email failed:", err.message)
    );

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