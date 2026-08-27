const nodemailer = require("nodemailer");

const MAIL_USER = process.env.MAIL_USER || "";
const MAIL_PASS = process.env.MAIL_PASS || "";

const isMailConfigured =
  MAIL_USER &&
  MAIL_PASS &&
  !MAIL_USER.includes("your-gmail") &&
  !MAIL_PASS.includes("your-16-char");

let transporter = null;

if (isMailConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.MAIL_PORT) || 465,
    secure: true,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    auth: { user: MAIL_USER, pass: MAIL_PASS },
    tls: { rejectUnauthorized: false },
  });

  transporter.verify((err) => {
    if (err) console.error("[Mailer] SMTP connection failed:", err.message);
    else console.log("[Mailer] SMTP ready");
  });
} else {
  console.warn("⚠️  Email not configured — emails will be skipped");
}

module.exports = transporter;
