const User = require("../models/User");
const Notification = require("../models/Notification");
const Society = require("../models/Society");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const ResidentHistory = require("../models/ResidentHistory");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const sequelize = require("../config/db");
const transporter = require("../utils/mailer");

/* =====
    EMAIL HELPERS
    ===== */
async function sendApprovalEmail(toEmail, userName, societyName) {
  if (!transporter) return;
  const appName = process.env.APP_NAME || "SocietyApp";

  await transporter.sendMail({
    from: `"${appName}" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `🎉 Welcome to ${societyName} — Registration Approved!`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
        
        <!-- Top gradient bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#16a34a,#22c55e,#4ade80);"></td></tr>
        
        <tr><td style="padding:36px 36px 28px;">
          
          <!-- Icon -->
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#dcfce7,#bbf7d0);border:1.5px solid rgba(34,197,94,0.35);line-height:72px;font-size:32px;text-align:center;">
              ✅
            </div>
          </div>

          <!-- Heading -->
          <h2 style="margin:0 0 8px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
            You're In! Registration Approved
          </h2>
          <p style="margin:0 0 24px;text-align:center;color:#64748b;font-size:14px;line-height:1.6;">
            Hi <strong>${userName}</strong>, great news — your registration request
            for <strong>${societyName}</strong> has been <strong style="color:#16a34a;">approved</strong>!
          </p>

          <!-- Green info box -->
          <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid rgba(34,197,94,0.3);border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#15803d;">
              Society
            </p>
            <p style="margin:0;font-size:20px;font-weight:800;color:#14532d;letter-spacing:-0.01em;">
              ${societyName}
            </p>
          </div>

          <!-- Steps -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;">
              Next Steps
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#22c55e;font-weight:700;margin-right:8px;">1.</span>
                  Open the <strong>${appName}</strong> app
                </td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#22c55e;font-weight:700;margin-right:8px;">2.</span>
                  Login with your registered email &amp; password
                </td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#22c55e;font-weight:700;margin-right:8px;">3.</span>
                  Verify the OTP sent to your email
                </td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#22c55e;font-weight:700;margin-right:8px;">4.</span>
                  Access your resident dashboard 🎉
                </td>
              </tr>
            </table>
          </div>

          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
            Welcome to the community! If you have any questions, please contact your society admin.
          </p>

        </td></tr>

        <!-- Footer -->
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

async function sendRejectionEmail(toEmail, userName, societyName, reason) {
  if (!transporter) return;
  const appName = process.env.APP_NAME || "SocietyApp";

  await transporter.sendMail({
    from: `"${appName}" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `Registration Update — ${societyName}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">

        <!-- Top gradient bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#dc2626,#ef4444,#f87171);"></td></tr>

        <tr><td style="padding:36px 36px 28px;">

          <!-- Icon -->
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1.5px solid rgba(239,68,68,0.35);line-height:72px;font-size:32px;text-align:center;">
              ❌
            </div>
          </div>

          <!-- Heading -->
          <h2 style="margin:0 0 8px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
            Registration Not Approved
          </h2>
          <p style="margin:0 0 24px;text-align:center;color:#64748b;font-size:14px;line-height:1.6;">
            Hi <strong>${userName}</strong>, unfortunately your registration request
            for <strong>${societyName}</strong> has been <strong style="color:#dc2626;">rejected</strong>
            by the society admin.
          </p>

          <!-- Reason box -->
          <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1.5px solid rgba(239,68,68,0.28);border-radius:16px;padding:24px;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#b91c1c;">
              Reason for Rejection
            </p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#7f1d1d;line-height:1.5;">
              ${reason}
            </p>
          </div>

          <!-- What to do box -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;">
              What can you do?
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#ef4444;font-weight:700;margin-right:8px;">•</span>
                  Contact your society admin for clarification
                </td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#ef4444;font-weight:700;margin-right:8px;">•</span>
                  Verify your flat number and personal details
                </td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#334155;">
                  <span style="color:#ef4444;font-weight:700;margin-right:8px;">•</span>
                  Re-register once the issue is resolved
                </td>
              </tr>
            </table>
          </div>

          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
            If you believe this is a mistake, please reach out to your society admin directly.
          </p>

        </td></tr>

        <!-- Footer -->
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

exports.approveResident = async (req, res) => {
  // Start a database transaction for data consistency
  const transaction = await sequelize.transaction();

  try {
    const { userId } = req.params;

    if (!userId) return res.status(400).json({ message: "User ID missing" });
    if (req.user.role !== "SOCIETY_ADMIN") return res.status(403).json({ message: "Only admin allowed" });

    const resident = await User.findByPk(userId, { transaction });
    if (!resident) {
      await transaction.rollback();
      return res.status(404).json({ message: "Resident not found" });
    }

    if (Number(resident.society_id) !== Number(req.user.society_id)) {
      await transaction.rollback();
      return res.status(403).json({ message: "Invalid society access" });
    }

    // 1. Activate Account
    resident.approval_status  = "APPROVED";
    resident.status           = "ACTIVE";
    resident.role             = "RESIDENT";
    resident.rejection_reason = null;
    await resident.save({ transaction });

    // 2. Sync Flat & Membership Data
    const pendingMembership = await FlatMembership.findOne({
      where: { user_id: resident.id, is_current: true },
      transaction
    });

    if (pendingMembership) {
      const flatId = pendingMembership.flat_id;
      const isTenant = resident.resident_type === "TENANT";

      // If a tenant is moving in, the owner is technically no longer staying
      if (isTenant) {
        await FlatMembership.update(
          { is_staying: false },
          { where: { flat_id: flatId, role: "OWNER", is_current: true }, transaction }
        );
      }

      // Update the Physical Flat Unit
      await Flat.update({
        resident_id: resident.id,
        occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED"
      }, { where: { id: flatId }, transaction });

      // Update Resident History Log
      await ResidentHistory.update(
        { move_out_date: new Date(), is_current: false },
        { where: { flat_id: flatId, is_current: true }, transaction }
      );
      
      await ResidentHistory.create({
        flat_id: flatId, 
        user_id: resident.id, 
        move_in_date: new Date(), 
        is_current: true 
      }, { transaction });
    }

    // 3. Send Notifications
    const notification = await Notification.create({
      title:            "Registration Approved ✅",
      message:          "Your registration has been approved. You can now login.",
      type:             "GENERAL",
      society_id:       resident.society_id,
      user_id:          resident.id,
      receiver_role:    "RESIDENT",
      receiver_user_id: resident.id,
    }, { transaction });

    // 3b. Notify the OWNER that their tenant was approved
    let ownerNotification = null;
    if (pendingMembership && resident.resident_type === "TENANT") {
      const ownerMembership = await FlatMembership.findOne({
        where: { flat_id: pendingMembership.flat_id, role: "OWNER", is_current: true },
        transaction,
      });
      if (ownerMembership) {
        const flat = await Flat.findByPk(pendingMembership.flat_id, { attributes: ["flat_number"], transaction });
        ownerNotification = await Notification.create({
          title:            "Tenant Approved ✅",
          message:          `Your tenant ${resident.name} for Flat ${flat?.flat_number || pendingMembership.flat_id} has been approved by the admin.`,
          type:             "SYSTEM",
          society_id:       resident.society_id,
          user_id:          ownerMembership.user_id,
          receiver_role:    "RESIDENT",
          receiver_user_id: ownerMembership.user_id,
        }, { transaction });
      }
    }

    // Commit the transaction
    await transaction.commit();

    if (global.io) {
      global.io.to(`user_${resident.id}`).emit("approval_status_update", {
        approval_status:  "APPROVED",
        rejection_reason: null,
        message:          "Your registration has been approved. You can now login.",
      });
      global.io.to(`user_${resident.id}`).emit("new_notification", notification);
      if (ownerNotification) {
        global.io.to(`user_${ownerNotification.receiver_user_id}`).emit("new_notification", ownerNotification);
      }
    }

    const society = await Society.findByPk(resident.society_id);
    res.json({ message: "Resident Approved Successfully" });

    // Fire-and-forget email (Outside transaction)
    sendApprovalEmail(resident.email, resident.name, society?.name || "your society")
      .catch((err) => console.error("[Email] Approve email error:", err.message));

  } catch (error) {
    await transaction.rollback();
    console.error("[approveResident]", error);
    res.status(500).json({ message: error.message });
  }
};




exports.rejectResident = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 1. Set the User to REJECTED and INACTIVE
    await user.update({ approval_status: "REJECTED", status: "INACTIVE" });

    // 2. Find any FlatMembership for this user
    const pendingMembership = await FlatMembership.findOne({ where: { user_id: userId } });

    let ownerId = null;
    let flatNumber = null;

    if (pendingMembership) {
      const flatId = pendingMembership.flat_id;
      
      // Destroy their membership and history completely
      await FlatMembership.destroy({ where: { user_id: userId } });
      await ResidentHistory.destroy({ where: { user_id: userId } });

      // Get flat number for notification
      const flat = await Flat.findByPk(flatId, { attributes: ["flat_number"] });
      flatNumber = flat?.flat_number || flatId;

      // Find the owner of this flat to revert back to them
      const ownerMembership = await FlatMembership.findOne({
        where: { flat_id: flatId, role: "OWNER", is_current: true }
      });

      if (ownerMembership) {
        ownerId = ownerMembership.user_id;
        await ownerMembership.update({ is_staying: true });
        await Flat.update(
          { resident_id: ownerMembership.user_id, occupancy_status: "OWNER_OCCUPIED" },
          { where: { id: flatId } }
        );
      } else {
        await Flat.update(
          { resident_id: null, occupancy_status: "VACANT" },
          { where: { id: flatId } }
        );
      }
    } else {
      // If no membership (e.g. resident registered themselves but wasn't fully set up)
      await Flat.update(
        { resident_id: null, occupancy_status: "VACANT" }, 
        { where: { resident_id: userId } }
      );
    }

    // 3. Notify the OWNER that their tenant was rejected
    if (ownerId && user.resident_type === "TENANT") {
      const ownerNotification = await Notification.create({
        title:            "Tenant Rejected ❌",
        message:          `Your tenant ${user.name} for Flat ${flatNumber} has been rejected by the admin.`,
        type:             "SYSTEM",
        society_id:       user.society_id,
        user_id:          ownerId,
        receiver_role:    "RESIDENT",
        receiver_user_id: ownerId,
      });

      if (global.io) {
        global.io.to(`user_${ownerId}`).emit("new_notification", ownerNotification);
      }
    }

    res.status(200).json({ message: "Tenant verification rejected and successfully wiped from the flat history." });
  } catch (error) {
    console.error("Error in rejectResident:", error);
    res.status(500).json({ error: "Internal Server Error while rejecting resident." });
  }
};


/* =====
    TENANT HISTORY — Full list of tenants (current + past) for society
    GET /admin/tenant-history?status=living|removed|expired|all
    ===== */
exports.getTenantHistory = async (req, res) => {
  try {
    const { Op } = require("sequelize");
    const status = req.query.status || "all"; // all, living, removed, expired, pending, approved, rejected
    const societyId = req.user.society_id;

    // 1. Fetch ALL tenant FlatMemberships for this society
    const memberships = await FlatMembership.findAll({
      where: { role: "TENANT" },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone", "approval_status", "status", "resident_type"],
          where: { society_id: societyId },
        },
        {
          model: Flat,
          attributes: ["id", "flat_number", "flat_type", "occupancy_status"],
          include: [
            { model: Floor, attributes: ["id", "floor_number"], required: false,
              include: [{ model: Block, attributes: ["id", "name"], required: false }]
            },
            { model: Block, attributes: ["id", "name"], required: false },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // 2. Fetch owner info for each flat
    const flatIds = [...new Set(memberships.map(m => m.flat_id))];
    const ownerMemberships = flatIds.length > 0
      ? await FlatMembership.findAll({
          where: { flat_id: { [Op.in]: flatIds }, role: "OWNER", is_current: true },
          include: [{ model: User, attributes: ["id", "name", "email"] }],
        })
      : [];

    const ownerMap = {};
    for (const om of ownerMemberships) {
      if (!ownerMap[om.flat_id]) {
        ownerMap[om.flat_id] = { id: om.User.id, name: om.User.name, email: om.User.email };
      }
    }

    // 3. For rejected tenants, also find users who have a rejected approval_status
    //    but whose FlatMembership was destroyed (rejectResident destroys memberships)
    const rejectedUsers = await User.findAll({
      where: {
        society_id: societyId,
        resident_type: "TENANT",
        approval_status: "REJECTED",
      },
      attributes: ["id", "name", "email", "phone", "approval_status", "status", "resident_type"],
    });

    const rejectedUserIds = rejectedUsers.map(u => u.id);

    // 3. Build the full tenant list
    let results = [];

    for (const m of memberships) {
      const user = m.User;
      const flat = m.Flat;
      const bName = flat?.Block?.name || flat?.Floor?.Block?.name || "";
      const fNum = flat?.flat_number || "";
      const flatLabel = bName ? `${fNum} - ${bName}` : fNum;

      let statusLabel = "UNKNOWN";
      if (user.approval_status === "PENDING") statusLabel = "PENDING";
      else if (user.approval_status === "REJECTED") statusLabel = "REJECTED";
      else if (m.is_current && (!m.move_out_date || new Date(m.move_out_date) > new Date())) statusLabel = "LIVING";
      else if (m.is_current && m.move_out_date && new Date(m.move_out_date) <= new Date()) statusLabel = "EXPIRED";
      else if (!m.is_current) statusLabel = "REMOVED";
      else statusLabel = "APPROVED";

      const owner = ownerMap[flat?.id] || null;

      results.push({
        tenant_id: user.id,
        tenant_name: user.name,
        tenant_email: user.email,
        tenant_phone: user.phone,
        approval_status: user.approval_status,
        user_status: user.status,
        resident_type: user.resident_type,
        flat_id: flat?.id,
        flat_number: fNum,
        flat_label: flatLabel,
        flat_type: flat?.flat_type || null,
        block_name: bName,
        occupancy_status: flat?.occupancy_status,
        membership_role: m.role,
        is_staying: m.is_staying,
        is_current: m.is_current,
        move_in_date: m.move_in_date,
        move_out_date: m.move_out_date,
        membership_created: m.created_at,
        status_label: statusLabel,
        owner_name: owner?.name || null,
        owner_email: owner?.email || null,
      });
    }

    // 4. Add rejected tenants whose memberships were destroyed
    for (const u of rejectedUsers) {
      // Skip if already in results (membership still exists)
      if (results.some(r => r.tenant_id === u.id)) continue;

      results.push({
        tenant_id: u.id,
        tenant_name: u.name,
        tenant_email: u.email,
        tenant_phone: u.phone,
        approval_status: u.approval_status,
        user_status: u.status,
        resident_type: u.resident_type,
        flat_id: null,
        flat_number: null,
        flat_label: null,
        flat_type: null,
        block_name: null,
        occupancy_status: null,
        membership_role: "TENANT",
        is_staying: false,
        is_current: false,
        move_in_date: null,
        move_out_date: null,
        membership_created: null,
        status_label: "REJECTED",
      });
    }

    // 5. Apply status filter
    if (status !== "all") {
      const statusUpper = status.toUpperCase();
      results = results.filter(r => r.status_label === statusUpper);
    }

    res.json({ data: results, total: results.length });
  } catch (error) {
    console.error("[getTenantHistory]", error);
    res.status(500).json({ message: error.message });
  }
};