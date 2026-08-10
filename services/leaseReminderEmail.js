/**
 * leaseReminderEmail.js
 * ---------------------
 * Generates the HTML for the 5-day lease-expiry reminder email.
 * Matches the visual style already used in sendAccountantWelcomeEmail.
 */

/**
 * @param {object} opts
 * @param {string} opts.tenantName      – Tenant's display name
 * @param {string} opts.flatLabel       – e.g. "Block A, Floor 2, Flat 304"
 * @param {string} opts.moveOutDate     – ISO date string  "YYYY-MM-DD"
 * @param {string} [opts.ownerName]     – Owner's name (optional)
 * @param {string} [opts.appName]       – App brand name (defaults to env var)
 * @returns {string}  Full HTML string
 */
function buildLeaseReminderHtml({ tenantName, flatLabel, moveOutDate, ownerName, appName }) {
  const brand = appName || process.env.APP_NAME || "SocietyApp";

  // Format date for display  →  "15 July 2025"
  const dateObj     = new Date(moveOutDate);
  const displayDate = dateObj.toLocaleDateString("en-IN", {
    day:   "numeric",
    month: "long",
    year:  "numeric",
    timeZone: "Asia/Kolkata",
  });

  const ownerLine = ownerName
    ? `<p style="margin:0 0 4px;font-size:13px;color:#64748b;">Your property owner is <strong>${ownerName}</strong>.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">

        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#f59e0b,#ef4444,#ec4899);"></td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 36px 28px;">

          <!-- Icon -->
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#fef3c7,#fee2e2);border:1.5px solid rgba(245,158,11,0.35);line-height:72px;font-size:32px;text-align:center;">⏳</div>
          </div>

          <!-- Heading -->
          <h2 style="margin:0 0 8px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
            Lease Expiring Soon
          </h2>
          <p style="margin:0 0 24px;text-align:center;color:#64748b;font-size:14px;line-height:1.6;">
            Hi <strong>${tenantName}</strong>, your lease agreement is ending in <strong>5 days</strong>.
          </p>

          <!-- Info card -->
          <div style="background:linear-gradient(135deg,#fef9c3,#fff7ed);border:1.5px solid rgba(245,158,11,0.3);border-radius:16px;padding:24px;margin-bottom:24px;">
            <p style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#92400e;text-align:center;">
              Lease Details
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:10px 10px 0 0;border-bottom:1px solid rgba(245,158,11,0.2);">
                  <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#92400e;">Flat / Unit</p>
                  <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#78350f;">${flatLabel}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:0 0 10px 10px;">
                  <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#92400e;">Lease End Date</p>
                  <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#b45309;">${displayDate}</p>
                </td>
              </tr>
            </table>
          </div>

          <!-- Owner line (optional) -->
          ${ownerLine}

          <!-- Warning notice -->
          <div style="background:#fef2f2;border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
            <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.6;">
              ⚠️ <strong>Action Required:</strong> Please contact your property owner or society admin to renew your lease or plan your move-out before <strong>${displayDate}</strong>.
            </p>
          </div>

          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
            If you have already renewed your lease, please ignore this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 36px;border-top:1px solid #f1f5f9;text-align:center;">
            <p style="margin:0;font-size:11px;color:#cbd5e1;">
              &copy; ${new Date().getFullYear()} ${brand}. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildLeaseReminderHtml };