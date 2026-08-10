/**
 * leaseReminderCron.js
 * --------------------
 * Drop this file anywhere (e.g. /jobs/leaseReminderCron.js) and call
 * `require("./jobs/leaseReminderCron")` once in your server entry (app.js / index.js)
 * AFTER global.io has been initialised.
 *
 * What it does every day at 09:00 IST:
 *   1. Finds every active TENANT FlatMembership whose move_out_date is exactly 5 days away.
 *   2. Sends the tenant an email reminder.
 *   3. Creates a Notification row so it shows up in the in-app bell.
 *   4. Emits a socket event to the tenant's personal room (user_<id>).
 *   5. Sends a push notification if the tenant has an FCM token.
 *
 * Dependencies already in your project:
 *   node-cron, sequelize, nodemailer / sendEmail, sendPushNotification
 *
 * Install node-cron if not yet present:
 *   npm install node-cron
 */

"use strict";

const cron         = require("node-cron");
const { Op }       = require("sequelize");

const FlatMembership = require("../models/FlatMembership");
const Flat           = require("../models/Flat");
const Floor          = require("../models/Floor");
const Block          = require("../models/Block");
const User           = require("../models/User");
const Notification   = require("../models/Notification");

const { sendEmail }            = require("../services/emailService");
const { sendPushNotification } = require("../utils/pushNotification");
const { buildLeaseReminderHtml } = require("../services/leaseReminderEmail");

/* ─────────────────────────────────────────────
   IST DATE HELPER
   Returns "YYYY-MM-DD" for N days from now in IST
───────────────────────────────────────────── */
function istDatePlusDays(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
}

/* ─────────────────────────────────────────────
   CORE JOB LOGIC  (exported so you can call it manually / test it)
───────────────────────────────────────────── */
async function runLeaseReminderJob() {
  const targetDate = istDatePlusDays(5); // leases ending exactly 5 days from today
  console.log(`[LeaseReminderCron] Running for target date: ${targetDate}`);

  try {
    /* ── Step 1: find all active tenant memberships expiring on targetDate ── */
    const expiringMemberships = await FlatMembership.findAll({
      where: {
        role:          "TENANT",
        is_current:    true,
        move_out_date: targetDate,          // exact match  "YYYY-MM-DD"
      },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "fcm_token", "society_id"],
        },
        {
          model: Flat,
          attributes: ["id", "flat_number", "block_id", "floor_id"],
          include: [
            {
              model:      Floor,
              required:   false,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, required: false, attributes: ["id", "name"] }],
            },
            { model: Block, required: false, attributes: ["id", "name"] },
          ],
        },
      ],
    });

    if (expiringMemberships.length === 0) {
      console.log("[LeaseReminderCron] No leases expiring in 5 days. Done.");
      return;
    }

    console.log(`[LeaseReminderCron] Found ${expiringMemberships.length} expiring lease(s).`);

    /* ── Step 2: process each membership ── */
    for (const membership of expiringMemberships) {
      const tenant = membership.User;
      const flat   = membership.Flat;

      if (!tenant || !flat) {
        console.warn(`[LeaseReminderCron] Skipping membership ${membership.id} — missing tenant or flat.`);
        continue;
      }

      /* Build a human-readable flat label */
      const blockName   = flat.Floor?.Block?.name || flat.Block?.name || null;
      const floorNumber = flat.Floor?.floor_number ?? null;
      const parts = [
        blockName   ? `Block ${blockName}`     : null,
        floorNumber != null ? `Floor ${floorNumber}` : null,
        `Flat ${flat.flat_number}`,
      ].filter(Boolean);
      const flatLabel = parts.join(", ");

      /* Find owner of the flat for the email (optional — best-effort) */
      let ownerName = null;
      try {
        const ownerMembership = await FlatMembership.findOne({
          where: { flat_id: flat.id, role: "OWNER", is_current: true },
          include: [{ model: User, attributes: ["name"] }],
        });
        ownerName = ownerMembership?.User?.name || null;
      } catch (_) { /* non-critical */ }

      /* ── 2a. Send Email ── */
      if (tenant.email) {
        try {
          await sendEmail({
            to:      tenant.email,
            subject: `⏳ Lease Expiring in 5 Days — ${flatLabel}`,
            html: buildLeaseReminderHtml({
              tenantName:  tenant.name,
              flatLabel,
              moveOutDate: membership.move_out_date,
              ownerName,
            }),
          });
          console.log(`[LeaseReminderCron] Email sent to ${tenant.email}`);
        } catch (emailErr) {
          console.error(`[LeaseReminderCron] Email failed for ${tenant.email}:`, emailErr.message);
        }
      }

      const notificationMessage =
        `Your lease for ${flatLabel} expires on ${membership.move_out_date}. ` +
        `Please contact your owner or admin to renew or plan your move-out.`;

      /* ── 2b. Save in-app Notification ── */
      let notification = null;
      try {
        notification = await Notification.create({
          title:            "Lease Expiring in 5 Days",
          message:          notificationMessage,
          type:             "LEASE",
          action_type:      "LEASE_REMINDER",
          action_route:     "/resident/profile",   // wherever tenant sees lease info
          society_id:       tenant.society_id,
          receiver_user_id: tenant.id,
        });
        console.log(`[LeaseReminderCron] Notification created for user ${tenant.id}`);
      } catch (notifErr) {
        console.error(`[LeaseReminderCron] Notification create failed for user ${tenant.id}:`, notifErr.message);
      }

      /* ── 2c. Emit real-time socket event ── */
      if (global.io) {
        global.io.to(`user_${tenant.id}`).emit("lease_expiry_reminder", {
          type:         "LEASE_REMINDER",
          message:      notificationMessage,
          flatLabel,
          moveOutDate:  membership.move_out_date,
          notification, // full row so the frontend can insert it into the bell list
        });
        console.log(`[LeaseReminderCron] Socket event emitted to user_${tenant.id}`);
      }

      /* ── 2d. Push notification (FCM) ── */
      if (tenant.fcm_token) {
        sendPushNotification(
          tenant.fcm_token,
          "⏳ Lease Expiring in 5 Days",
          `Your lease for ${flatLabel} ends on ${membership.move_out_date}. Tap to view details.`,
          { type: "LEASE_REMINDER", route: "/resident/profile" }
        ).catch((pushErr) =>
          console.error(`[LeaseReminderCron] Push failed for user ${tenant.id}:`, pushErr.message)
        );
      }
    }

    console.log("[LeaseReminderCron] Job completed.");
  } catch (err) {
    console.error("[LeaseReminderCron] FATAL ERROR:", err);
  }
}

/* ─────────────────────────────────────────────
   SCHEDULE
   Runs every day at 09:00 IST.
   node-cron runs in server local time; if your server is UTC,
   09:00 IST = 03:30 UTC  →  cron string "30 3 * * *"
   If server is already IST, use "0 9 * * *"
───────────────────────────────────────────── */
const CRON_SCHEDULE =
  process.env.LEASE_REMINDER_CRON ||
  (process.env.TZ === "Asia/Kolkata" ? "0 9 * * *" : "30 3 * * *");

cron.schedule(CRON_SCHEDULE, () => {
  console.log("[LeaseReminderCron] Triggered by scheduler.");
  runLeaseReminderJob();
}, {
  timezone: "Asia/Kolkata", // node-cron v3+ supports this directly
});

console.log(`[LeaseReminderCron] Scheduled with pattern "${CRON_SCHEDULE}" (IST 09:00).`);

/* Export the raw function so you can:
   - Call it manually from an admin endpoint (for testing)
   - Write unit tests against it
*/
module.exports = { runLeaseReminderJob };