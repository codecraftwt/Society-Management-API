
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const User = require("../models/User");
const UserSociety = require("../models/UserSociety");
const UserSocietyRole = require("../models/UserSocietyRole");
const bcrypt = require("bcryptjs");
const Society = require("../models/Society");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const HouseHoldMember = require("../models/HouseHoldMember");
const Bill = require("../models/Bill");
const ParkingRequest = require("../models/ParkingRequest");
const ResidentHistory = require("../models/ResidentHistory");
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../services/emailService");
const FlatMembership = require("../models/FlatMembership");
const ParkingSlot = require("../models/ParkingSlot");
const Vehicle = require("../models/Vehicle"); 
const AccountantAssignment = require("../models/AccountantAssignment");
const UserDocuments = require("../models/UserDocuments");
const transporter = require("../utils/mailer");
const { fetchEffectivePermissions } = require("./permissionController");
const notificationService = require("../services/notificationService");
const {
  readUploadedProfilePicture,
  destroyProfilePicture,
  isProfilePictureOwnedBy,
  normaliseMultipartBody,
} = require("../utils/profilePicture");
const {
  sanitizeText,
  isEmpty,
  isValidEmail,
  isValidMobile,
  isValidTitle,
  isValidPersonName,
  isValidPassword,
  isPositiveNumber,
} = require("../utils/validation");
const { ensureAssignable, ensureNotRejected } = require("../utils/approvalGuard");
const { getOccupancyContextForFlats } = require("../utils/flatOccupancy");

async function sendAccountantWelcomeEmail(toEmail, name, password, societyName) {
  if (!transporter) return;
  const appName = process.env.APP_NAME || "SocietyApp";

  await transporter.sendMail({
    from: `"${appName}" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `Welcome to ${appName} — Your Accountant Account is Ready`,
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
            <div style="display:inline-block;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1.5px solid rgba(99,102,241,0.3);line-height:72px;font-size:32px;text-align:center;">🧾</div>
          </div>
          <h2 style="margin:0 0 8px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">Welcome, ${name}!</h2>
          <p style="margin:0 0 24px;text-align:center;color:#64748b;font-size:14px;line-height:1.6;">Your <strong>Accountant</strong> account has been created for <strong>${societyName}</strong>.</p>
          <div style="background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1.5px solid rgba(99,102,241,0.25);border-radius:16px;padding:24px;margin-bottom:24px;">
            <p style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;text-align:center;">Your Login Credentials</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:10px 10px 0 0;border-bottom:1px solid rgba(99,102,241,0.12);">
                <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Email</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e40af;">${toEmail}</p>
              </td></tr>
              <tr><td style="padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:0 0 10px 10px;">
                <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Password</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:800;letter-spacing:0.15em;color:#1e40af;font-family:'Courier New',monospace;">${password}</p>
              </td></tr>
            </table>
          </div>
          <div style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:10px;padding:12px 16px;margin-bottom:20px;">
            <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">⚠️ <strong>Important:</strong> Please change your password after your first login.</p>
          </div>
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">If you did not expect this email, please contact your society admin.</p>
        </td></tr>
        <tr><td style="padding:16px 36px;border-top:1px solid #f1f5f9;text-align:center;">
          <p style="margin:0;font-size:11px;color:#cbd5e1;">&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

/* =====
   CREATE / PROMOTE SOCIETY ADMIN
   ===== */
const createSocietyAdmin = async (req, res) => {
  try {
    const rawName = sanitizeText(req.body.name);
    const rawEmail = sanitizeText(req.body.email);
    const password = req.body.password;

    if (!isValidTitle(rawName)) {
      return res.status(400).json({
        message: "Name must be at least 4 characters and cannot be numbers or symbols only.",
      });
    }
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (isEmpty(password)) {
      return res.status(400).json({ message: "Password is required." });
    }

    const name = rawName;
    const email = rawEmail;
    const targetSocietyId = Number(req.params.societyId || req.body.society_id);

    if (!targetSocietyId) {
      return res.status(400).json({ message: "Society ID is required." });
    }

    const existingUser = await User.findOne({ where: { email } });
    let adminUser;

    if (existingUser) {
      const roles = Array.isArray(existingUser.roles) ? existingUser.roles : [existingUser.role].filter(Boolean);
      const updatedRoles = [...new Set(["SOCIETY_ADMIN", ...roles])];
      await existingUser.update({
        name,
        role: "SOCIETY_ADMIN",
        roles: updatedRoles,
        society_id: targetSocietyId,
        approval_status: "APPROVED",
        status: "ACTIVE",
        rejection_reason: null,
        approved_by_user_id: req.user?.id || null,
        approved_by_name: req.user?.name || "Super Admin",
        approved_by_role: "SUPER_ADMIN",
        approved_at: new Date(),
      });
      adminUser = existingUser;

      sendEmail({
        to: email,
        subject: "Society Admin Account Updated",
        html: `<h2>Hello ${name}</h2><p>Your Society Admin account has been activated for society #${targetSocietyId}.</p>`,
      }).catch((err) => console.error("[Mailer] Admin update email failed:", err.message));
    } else {
      const hashed = await bcrypt.hash(password, 8);
      adminUser = await User.create({
        name,
        email,
        password: hashed,
        role: "SOCIETY_ADMIN",
        roles: ["SOCIETY_ADMIN"],
        society_id: targetSocietyId,
        approval_status: "APPROVED",
        status: "ACTIVE",
        approved_by_user_id: req.user?.id || null,
        approved_by_name: req.user?.name || "Super Admin",
        approved_by_role: "SUPER_ADMIN",
        approved_at: new Date(),
      });

      sendEmail({
        to: email,
        subject: "Society Admin Account Created",
        html: `<h2>Welcome ${name}</h2><p><b>Email:</b> ${email}</p><p><b>Password:</b> ${password}</p>`,
      }).catch((err) => console.error("[Mailer] Admin create email failed:", err.message));
    }

    // Ensure UserSociety membership is ACTIVE and is_default = true
    const [userSoc] = await UserSociety.findOrCreate({
      where: { user_id: adminUser.id, society_id: targetSocietyId },
      defaults: {
        user_id: adminUser.id,
        society_id: targetSocietyId,
        membership_status: "ACTIVE",
        is_default: true,
      },
    });

    if (userSoc.membership_status !== "ACTIVE" || !userSoc.is_default) {
      await userSoc.update({ membership_status: "ACTIVE", is_default: true });
    }

    // Ensure UserSocietyRole has SOCIETY_ADMIN
    await UserSocietyRole.findOrCreate({
      where: { user_society_id: userSoc.id, role: "SOCIETY_ADMIN" },
      defaults: {
        user_society_id: userSoc.id,
        role: "SOCIETY_ADMIN",
      },
    });

    return res.status(200).json({
      message: existingUser ? "Admin updated successfully" : "Admin created successfully",
      user: adminUser,
    });
  } catch (err) {
    console.error("createSocietyAdmin error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   CREATE RESIDENT
   Supports: mandatory parking slots, multiple vehicles (DEFAULT / EXTRA)
   ===== */
// const createResident = async (req, res) => {
//   try {
//     const {
//       name,
//       email,
//       password,
//       phone,
//       flat_id,
//       resident_type,
//       flat_type,
//       flat_assignments,
//       occupant_count,
//       emergency_contact,
//       vehicles,        // Optional
//       parking_slots    // Optional fallback: [1,5]
//     } = req.body;

//     /* ─────────────────────────────
//        Emergency Contact Validation
//     ───────────────────────────── */
//     if (
//       emergency_contact &&
//       (!emergency_contact.name || !emergency_contact.phone)
//     ) {
//       return res.status(400).json({
//         message: "emergency_contact must include both name and phone.",
//       });
//     }

//     /* ─────────────────────────────
//        Password Hash
//     ───────────────────────────── */
//     const hashed = await bcrypt.hash(password, 8);

//     /* ─────────────────────────────
//        Create Resident User
//     ───────────────────────────── */
//     const resident = await User.create({
//       name,
//       email,
//       phone,
//       password: hashed,
//       role: "RESIDENT",
//       roles: ["RESIDENT"],
//       society_id: req.user.society_id,
//       approval_status: "APPROVED",
//       status: "ACTIVE",
//       resident_type: resident_type || "OWNER",
//       vehicle_count: 0, // updated later
//       occupant_count:
//         occupant_count != null ? Number(occupant_count) : 1,
//       emergency_contact: emergency_contact || null,
//     });

//     let targetFlatId = flat_id || null;

//     /* ====
//        MULTI-FLAT SUPPORT (OPTIONAL)
//     ==== */
//     if (
//       flat_assignments &&
//       Array.isArray(flat_assignments) &&
//       flat_assignments.length > 0
//     ) {
//       targetFlatId = flat_assignments[0].flat_id;

//       for (const assignment of flat_assignments) {
//         const { flat_id: aFlatId, flat_type: aFlatType } = assignment;
//         if (!aFlatId) continue;

//         await ResidentHistory.update(
//           { move_out_date: new Date(), is_current: false },
//           { where: { flat_id: aFlatId, is_current: true } }
//         );

//         await ResidentHistory.create({
//           flat_id: aFlatId,
//           user_id: resident.id,
//           move_in_date: new Date(),
//           is_current: true,
//         });

//         const isTenant = resident_type === "TENANT";

//         await Flat.update(
//           {
//             resident_id: resident.id,
//             occupancy_status: isTenant
//               ? "RENTED"
//               : "OWNER_OCCUPIED",
//             ...(aFlatType && { flat_type: aFlatType }),
//           },
//           { where: { id: aFlatId } }
//         );

//         await FlatMembership.update(
//           { is_current: false, move_out_date: new Date() },
//           {
//             where: {
//               flat_id: aFlatId,
//               is_current: true,
//             },
//           }
//         );

//         await FlatMembership.create({
//           flat_id: aFlatId,
//           user_id: resident.id,
//           role: resident_type || "OWNER",
//           is_staying: true,
//           pays_maintenance: true,
//           move_in_date: new Date(),
//           is_current: true,
//         });

//         /* ✅ MULTI SLOT ASSIGNMENT PER FLAT */
//         if (
//           assignment.parking_slots &&
//           assignment.parking_slots.length > 0
//         ) {
//           for (const slotData of assignment.parking_slots) {
//             await ParkingSlot.update(
//               {
//                 resident_id: resident.id,
//                 flat_id: aFlatId,
//                 status: "ASSIGNED",
//                 parking_type: slotData.parking_type,
//               },
//               { where: { id: slotData.slot_id } }
//             );
//           }
//         }
//       }
//     }

//     /* ====
//        SINGLE FLAT (OPTIONAL)
//     ==== */
//     else if (flat_id) {
//       await ResidentHistory.update(
//         { move_out_date: new Date(), is_current: false },
//         { where: { flat_id, is_current: true } }
//       );

//       await ResidentHistory.create({
//         flat_id,
//         user_id: resident.id,
//         move_in_date: new Date(),
//         is_current: true,
//       });

//       const isTenant = resident_type === "TENANT";

//       await Flat.update(
//         {
//           resident_id: resident.id,
//           occupancy_status: isTenant
//             ? "RENTED"
//             : "OWNER_OCCUPIED",
//           ...(flat_type && { flat_type }),
//         },
//         { where: { id: flat_id } }
//       );

//       await FlatMembership.update(
//         { is_current: false, move_out_date: new Date() },
//         { where: { flat_id, is_current: true } }
//       );

//       await FlatMembership.create({
//         flat_id,
//         user_id: resident.id,
//         role: resident_type || "OWNER",
//         is_staying: true,
//         pays_maintenance: true,
//         move_in_date: new Date(),
//         is_current: true,
//       });
//     }

//     /* ====
//        VEHICLES (OPTIONAL)
//     ==== */

//     let vehicleData = vehicles || [];

//     if (
//       vehicleData.length === 0 &&
//       parking_slots &&
//       parking_slots.length > 0
//     ) {
//       vehicleData = parking_slots.map((slot_id) => ({
//         vehicle_number: "TBD",
//         vehicle_type: "OTHER",
//         vehicle_name: "TBD",
//         parking_slot_id: slot_id,
//       }));
//     }

//     for (let i = 0; i < vehicleData.length; i++) {
//       const v = vehicleData[i];
//       const typeOfParking = i === 0 ? "DEFAULT" : "EXTRA";

//       const createdVehicle = await Vehicle.create({
//         vehicle_number: v.vehicle_number || "TBD",
//         vehicle_type: v.vehicle_type || "OTHER",
//         vehicle_name: v.vehicle_name || "TBD",
//         resident_id: resident.id,
//         flat_id: targetFlatId,
//         society_id: req.user.society_id,
//         parking_slot_id: v.parking_slot_id || null,
//         parking_type: typeOfParking,
//       });

//       if (v.parking_slot_id) {
//         await ParkingSlot.update(
//           {
//             resident_id: resident.id,
//             flat_id: targetFlatId,
//             status: "ASSIGNED",
//           },
//           { where: { id: v.parking_slot_id } }
//         );
//       }
//     }

//     /* ✅ Sync vehicle_count correctly */
//     await resident.update({
//       vehicle_count: vehicleData.length,
//     });

//     /* ====
//        RESPONSE
//     ==== */
//     res.status(201).json({
//       id: resident.id,
//       user: { id: resident.id },
//       resident,
//     });

//     sendEmail({
//       to: email,
//       subject: "Society Resident Account Created",
//       html: `<h2>Welcome ${name}</h2><p>Your Resident account has been created.</p>`,
//     }).catch((err) =>
//       console.error("[Mailer] Resident create email failed:", err.message)
//     );

//   } catch (err) {
//     console.error("[createResident]", err);
//     res.status(500).json({ message: err.message });
//   }
// };


/* =====
   CHECK RESIDENT EMAIL
   Checks if an email exists globally and if the user is already in the target society.
   ===== */
const checkResidentEmail = async (req, res) => {
  try {
    const email = sanitizeText(req.query.email || req.body.email || "");
    const rawSocietyId = req.query.society_id || req.body.society_id || req.headers["x-society-id"];
    const targetSocietyId = (req.user?.role === "SUPER_ADMIN" || req.user?.activeRole === "SUPER_ADMIN")
      ? (rawSocietyId || req.user?.society_id)
      : req.user?.society_id;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
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
    if (targetSocietyId) {
      const membership = await UserSociety.findOne({
        where: {
          user_id: existingUser.id,
          society_id: targetSocietyId,
          membership_status: { [Op.ne]: "REJECTED" },
        },
      });
      if (membership || String(existingUser.society_id) === String(targetSocietyId)) {
        isMember = true;
      }
    }

    const docs = await UserDocuments.findOne({
      where: { user_id: existingUser.id },
      attributes: ["aadhar_url", "pan_url", "aadhar_public_id", "pan_public_id"],
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
        message: "A resident with this email already belongs to the selected society.",
        user: userPayload,
      });
    }

    return res.status(200).json({
      exists: true,
      alreadyMember: false,
      message: "An account with this email already exists in the system. You can reuse this account to add the resident to this society with their existing details and documents.",
      user: userPayload,
    });
  } catch (err) {
    console.error("[checkResidentEmail]", err);
    return res.status(500).json({ message: err.message });
  }
};

const createResident = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    let {
      name,
      email,
      password,
      phone,
      flat_id,
      resident_type,
      flat_type,
      flat_assignments,
      occupant_count,
      emergency_contact,
      vehicles,
      parking_slots,
      useExistingAccount,
      society_id: bodySocietyId,
    } = normaliseMultipartBody(req.body);

    const rawName = sanitizeText(name);
    const rawEmail = sanitizeText(email);

    if (!isValidEmail(rawEmail)) {
      await transaction.rollback();
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    const rawSocietyId = req.headers["x-society-id"] || bodySocietyId;
    const targetSocietyId = (req.user?.role === "SUPER_ADMIN" || req.user?.activeRole === "SUPER_ADMIN")
      ? (rawSocietyId || req.user?.society_id)
      : req.user?.society_id;

    if (!targetSocietyId) {
      await transaction.rollback();
      return res.status(400).json({ message: "Target society is required." });
    }

    if (occupant_count != null && (!Number.isInteger(Number(occupant_count)) || Number(occupant_count) < 1)) {
      await transaction.rollback();
      return res.status(400).json({ message: "Occupant count must be a positive number." });
    }
    if (resident_type && !["OWNER", "TENANT"].includes(resident_type)) {
      await transaction.rollback();
      return res.status(400).json({ message: "resident_type must be OWNER or TENANT." });
    }

    /* ─────────────────────────────
       Flat is COMPULSORY
    ───────────────────────────── */
    const hasFlatAssignments =
      Array.isArray(flat_assignments) &&
      flat_assignments.some((a) => a.flat_id);

    if (!flat_id && !hasFlatAssignments) {
      await transaction.rollback();
      return res.status(400).json({
        message: "At least one flat assignment is required to create a resident.",
      });
    }

    /* ─────────────────────────────
       Emergency Contact Validation
    ───────────────────────────── */
    if (
      emergency_contact &&
      (!emergency_contact.name || !emergency_contact.phone)
    ) {
      await transaction.rollback();
      return res.status(400).json({
        message: "emergency_contact must include both name and phone.",
      });
    }

    /* ─────────────────────────────
       Check for existing user with this email
    ───────────────────────────── */
    const existingUser = await User.findOne({
      where: { email: rawEmail },
      transaction,
    });

    let resident;
    let isReused = false;

    if (existingUser) {
      // Check if already a member in this society
      const existingMembership = await UserSociety.findOne({
        where: {
          user_id: existingUser.id,
          society_id: targetSocietyId,
          membership_status: { [Op.ne]: "REJECTED" },
        },
        transaction,
      });

      if (existingMembership || String(existingUser.society_id) === String(targetSocietyId)) {
        await transaction.rollback();
        return res.status(400).json({
          message: "Resident with this email is already registered in the selected society.",
        });
      }

      // Reuse existing account for this new society
      isReused = true;
      resident = existingUser;
    } else {
      // New user registration validation
      if (!isValidPersonName(rawName)) {
        await transaction.rollback();
        return res.status(400).json({
          message: "Name must be at least 2 characters and contain only letters, spaces, dots, apostrophes or hyphens.",
        });
      }
      if (isEmpty(password)) {
        password = "Admin@123";
      }
      if (typeof password === "string" && password.length < 6) {
        await transaction.rollback();
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      if (phone && !isValidMobile(phone)) {
        await transaction.rollback();
        return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
      }

      const hashed = await bcrypt.hash(password, 8);
      const profilePic = req.file ? readUploadedProfilePicture(req.file) : null;

      resident = await User.create({
        name: rawName,
        email: rawEmail,
        phone: phone || null,
        password: hashed,
        role: "RESIDENT",
        roles: ["RESIDENT"],
        society_id: targetSocietyId,
        approval_status: "APPROVED",
        status: "ACTIVE",
        resident_type: resident_type || "OWNER",
        vehicle_count: 0,
        occupant_count: occupant_count != null ? Number(occupant_count) : 1,
        emergency_contact: emergency_contact || null,
        profile_picture: profilePic?.url || null,
        profile_picture_public_id: profilePic?.publicId || null,
      }, { transaction });
    }

    /* ─────────────────────────────
       Normalized Multi-Society Membership & Roles
    ───────────────────────────── */
    const [userSociety] = await UserSociety.findOrCreate({
      where: {
        user_id: resident.id,
        society_id: targetSocietyId,
      },
      defaults: {
        membership_status: "ACTIVE",
        resident_type: resident_type || "OWNER",
        occupant_count: occupant_count != null ? Number(occupant_count) : 1,
        vehicle_count: 0,
        emergency_contact: emergency_contact || null,
        source: "ADMIN_ASSIGNED",
      },
      transaction,
    });

    if (userSociety.membership_status !== "ACTIVE") {
      await userSociety.update({ membership_status: "ACTIVE" }, { transaction });
    }

    await UserSocietyRole.findOrCreate({
      where: {
        user_society_id: userSociety.id,
        role: "RESIDENT",
      },
      defaults: {
        user_society_id: userSociety.id,
        role: "RESIDENT",
      },
      transaction,
    });

    let targetFlatId = flat_id || null;

    /* ====
       MULTI-FLAT SUPPORT
    ==== */
    if (hasFlatAssignments) {
      targetFlatId = flat_assignments[0].flat_id;

      for (const assignment of flat_assignments) {
        const { flat_id: aFlatId, flat_type: aFlatType } = assignment;
        if (!aFlatId) continue;

        await ResidentHistory.update(
          { move_out_date: new Date(), is_current: false },
          { where: { flat_id: aFlatId, is_current: true }, transaction }
        );

        await ResidentHistory.create({
          flat_id:      aFlatId,
          user_id:      resident.id,
          move_in_date: new Date(),
          is_current:   true,
        }, { transaction });

        const isTenant = resident_type === "TENANT";

        const existingFlat = await Flat.findByPk(aFlatId, { transaction });
        const shouldSetFlatType = !existingFlat?.flat_type && aFlatType && ["1BHK", "2BHK", "3BHK"].includes(aFlatType);

        await Flat.update(
          {
            resident_id:      resident.id,
            occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
            ...(shouldSetFlatType && { flat_type: aFlatType }),
          },
          { where: { id: aFlatId }, transaction }
        );

        await FlatMembership.update(
          { is_current: false, move_out_date: new Date() },
          { where: { flat_id: aFlatId, is_current: true }, transaction }
        );

        await FlatMembership.create({
          flat_id:          aFlatId,
          user_id:          resident.id,
          society_id:       targetSocietyId,
          role:             resident_type || "OWNER",
          is_staying:       true,
          pays_maintenance: true,
          move_in_date:     new Date(),
          is_current:       true,
        }, { transaction });

        /* ── Multi slot assignment per flat ── */
        if (
          assignment.parking_slots &&
          assignment.parking_slots.length > 0
        ) {
          for (const slotData of assignment.parking_slots) {
            await ParkingSlot.update(
              {
                resident_id:  resident.id,
                flat_id:      aFlatId,
                status:       "ASSIGNED",
                parking_type: slotData.parking_type,
              },
              { where: { id: slotData.slot_id }, transaction }
            );
          }
        }
      }
    }

    /* ====
       SINGLE FLAT FALLBACK
    ==== */
    else if (flat_id) {
      await ResidentHistory.update(
        { move_out_date: new Date(), is_current: false },
        { where: { flat_id, is_current: true }, transaction }
      );

      await ResidentHistory.create({
        flat_id,
        user_id:      resident.id,
        move_in_date: new Date(),
        is_current:   true,
      }, { transaction });

      const isTenant = resident_type === "TENANT";

      const existingFlat = await Flat.findByPk(flat_id, { transaction });
      const shouldSetFlatType = !existingFlat?.flat_type && flat_type && ["1BHK", "2BHK", "3BHK"].includes(flat_type);

      await Flat.update(
        {
          resident_id:      resident.id,
          occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
          ...(shouldSetFlatType && { flat_type }),
        },
        { where: { id: flat_id }, transaction }
      );

      await FlatMembership.update(
        { is_current: false, move_out_date: new Date() },
        { where: { flat_id, is_current: true }, transaction }
      );

      await FlatMembership.create({
        flat_id,
        user_id:          resident.id,
        society_id:       targetSocietyId,
        role:             resident_type || "OWNER",
        is_staying:       true,
        pays_maintenance: true,
        move_in_date:     new Date(),
        is_current:       true,
      }, { transaction });
    }

    /* ====
       VEHICLES (OPTIONAL)
    ==== */
    let vehicleData = vehicles || [];

    if (
      vehicleData.length === 0 &&
      parking_slots &&
      parking_slots.length > 0
    ) {
      vehicleData = parking_slots.map((slot_id) => ({
        vehicle_number:  "TBD",
        vehicle_type:    "OTHER",
        vehicle_name:    "TBD",
        parking_slot_id: slot_id,
      }));
    }

    for (let i = 0; i < vehicleData.length; i++) {
      const v             = vehicleData[i];
      const typeOfParking = i === 0 ? "DEFAULT" : "EXTRA";

      await Vehicle.create({
        vehicle_number:  v.vehicle_number || "TBD",
        vehicle_type:    v.vehicle_type   || "OTHER",
        vehicle_name:    v.vehicle_name   || "TBD",
        resident_id:     resident.id,
        flat_id:         targetFlatId,
        society_id:      targetSocietyId,
        parking_slot_id: v.parking_slot_id || null,
        parking_type:    typeOfParking,
      }, { transaction });

      if (v.parking_slot_id) {
        await ParkingSlot.update(
          {
            resident_id: resident.id,
            flat_id:     targetFlatId,
            status:      "ASSIGNED",
          },
          { where: { id: v.parking_slot_id }, transaction }
        );
      }
    }

    await resident.update({ vehicle_count: vehicleData.length }, { transaction });

    await transaction.commit();

    /* ====
       RESPONSE
    ==== */
    res.status(201).json({
      id:       resident.id,
      user:     { id: resident.id },
      resident,
      reused:   isReused,
      message:  isReused
        ? "Existing resident added to society successfully"
        : "Resident created successfully",
    });

    if (!isReused) {
      sendEmail({
        to:      rawEmail,
        subject: "Society Resident Account Created",
        html:    `<h2>Welcome ${resident.name}</h2><p>Your Resident account has been created.</p>`,
      }).catch((err) =>
        console.error("[Mailer] Resident create email failed:", err.message)
      );
    } else {
      sendEmail({
        to:      rawEmail,
        subject: "Added to New Society",
        html:    `<h2>Hello ${resident.name}</h2><p>You have been assigned to a flat in a new society. You can now switch to this society using your existing login credentials.</p>`,
      }).catch((err) =>
        console.error("[Mailer] Resident add society email failed:", err.message)
      );
    }

  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    if (req.file) {
      const pic = readUploadedProfilePicture(req.file);
      if (pic?.publicId) {
        destroyProfilePicture(pic.publicId).catch(() => {});
      }
    }
    console.error("[createResident]", err);
    res.status(500).json({ message: err.message });
  }
};
/* =====
   CREATE GUARD
   ===== */
const createGuard = async (req, res) => {
  try {
    const name = sanitizeText(req.body.name);
    const email = sanitizeText(req.body.email);
    const password = req.body.password;

    if (!isValidPersonName(name)) {
      return res.status(400).json({
        message: "Name must be at least 2 characters and contain only letters, spaces, dots, apostrophes or hyphens.",
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (isEmpty(password)) {
      return res.status(400).json({ message: "Password is required." });
    }
    if (typeof password === "string" && password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "A user with this email already exists." });
    }

    const hashed = await bcrypt.hash(password, 8);
    const guard = await User.create({
        name, email, password: hashed,
        role: "GUARD", roles: ["GUARD"],
        society_id: req.body.society_id || req.user.society_id,
        profile_picture: req.file ? readUploadedProfilePicture(req.file)?.url || null : null,
        profile_picture_public_id: req.file ? readUploadedProfilePicture(req.file)?.publicId || null : null,
      });
    res.status(200).json(guard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET GUARDS
   ===== */
const getGuards = async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === "SUPER_ADMIN" || req.user.activeRole === "SUPER_ADMIN";
    const targetSocietyId = isSuperAdmin
      ? (req.params.societyId || req.query.society_id || null)
      : req.user.society_id;
    const where = targetSocietyId ? { society_id: targetSocietyId } : {};

    const allUsers = await User.findAll({
      where,
      include: { model: Society, attributes: ["id", "name"], required: false },
      attributes: ["id", "name", "email", "phone", "role", "roles", "society_id", "profile_picture"],
    });

    const guards = allUsers.filter((u) => (u.roles || [u.role]).includes("GUARD"));
    res.status(200).json(
      guards.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        shiftType: null,
        isActive: true,
        society_id: g.society_id,
        societyName: g.Society?.name || "NA",
        profile_picture: g.profile_picture || null,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   UPDATE GUARD
   ===== */
const updateGuard = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;

    const guard = await User.findByPk(id);
    if (!guard || !(guard.roles || [guard.role]).includes("GUARD")) {
      return res.status(404).json({ message: "Guard not found" });
    }

    if (name !== undefined && !isValidPersonName(sanitizeText(name))) {
      return res.status(400).json({
        message: "Name must be at least 2 characters and contain only letters, spaces, dots, apostrophes or hyphens.",
      });
    }
    if (email !== undefined && !isValidEmail(sanitizeText(email))) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 6)) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    // Security check
    if (req.user.role !== "SUPER_ADMIN" && String(guard.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (password) {
      updateData.password = await bcrypt.hash(password, 8);
    }
    if (req.user.role === "SUPER_ADMIN" && req.body.society_id) {
      updateData.society_id = req.body.society_id;
    }
    if (req.file) {
      const photoData = readUploadedProfilePicture(req.file);
      if (photoData?.url) updateData.profile_picture = photoData.url;
      if (photoData?.publicId) updateData.profile_picture_public_id = photoData.publicId;
    }

    await guard.update(updateData);
    res.status(200).json(guard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   DELETE GUARD
   ===== */
const deleteGuard = async (req, res) => {
  try {
    const { id } = req.params;
    const guard = await User.findByPk(id);
    if (!guard) return res.status(404).json({ message: "Guard not found" });
    if (!(guard.roles || [guard.role]).includes("GUARD"))
      return res.status(404).json({ message: "Guard not found" });
    await guard.destroy();
    res.json({ message: "Guard deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// /* =====
//    GET RESIDENTS
//    ===== */
// const getResidents = async (req, res) => {
//   try {
//     const { Op } = require("sequelize");

//     const page   = Math.max(1, parseInt(req.query.page)  || 1);
//     const limit  = Math.min(50, parseInt(req.query.limit) || 10);
//     const offset = (page - 1) * limit;
//     const search = req.query.search?.trim() || "";

//     const searchWhere = { society_id: req.user.society_id };
//     if (search) {
//       searchWhere[Op.or] = [
//         { name:  { [Op.like]: `%${search}%` } },
//         { email: { [Op.like]: `%${search}%` } },
//       ];
//     }

//     const allUsers = await User.findAll({
//       where: searchWhere,
//       order: [["name", "ASC"]],
//     });

//     const residentUsers = allUsers.filter((u) =>
//       (u.roles || [u.role]).includes("RESIDENT")
//     );

//     const emailMap = new Map();
//     residentUsers.forEach(user => {
//       const key = user.email ? user.email.toLowerCase().trim() : user.id;
//       if (!emailMap.has(key)) emailMap.set(key, user.toJSON());
//     });

//     const uniqueResidents = Array.from(emailMap.values());
//     const count     = uniqueResidents.length;
//     const paginated = uniqueResidents.slice(offset, offset + limit);

//     const userIds = paginated.map(u => u.id);

//     const allFlats = await Flat.findAll({
//       where: { resident_id: { [Op.in]: userIds } },
//       attributes: ["id", "flat_number", "flat_type", "floor_id", "resident_id"],
//       include: [
//         {
//           model: Floor,
//           attributes: ["id", "floor_number"],
//           required: false,
//           include: [{ model: Block, attributes: ["id", "name"], required: false }],
//         },
//         {
//           model: Block,
//           attributes: ["id", "name"],
//           required: false,
//         },
//       ],
//     });

//     const data = paginated.map(user => {
//       const userFlats = allFlats
//         .filter(f => f.resident_id === user.id)
//         .map(f => ({
//           id:           f.id,
//           flat_id:      f.id,
//           flat_number:  f.flat_number,
//           flat_type:    f.flat_type,
//           floor_id:     f.floor_id,
//           Floor: f.Floor ? {
//             id:           f.Floor.id,
//             floor_number: f.Floor.floor_number,
//             Block: f.Floor.Block ? { id: f.Floor.Block.id, name: f.Floor.Block.name } : null,
//           } : null,
//           Block: f.Block ? { id: f.Block.id, name: f.Block.name } : null,
//           floor_number: f.Floor?.floor_number ?? null,
//           block_name:   f.Floor?.Block?.name || f.Block?.name || null,
//         }));

//       return {
//         id:                user.id,
//         name:              user.name,
//         email:             user.email,
//         phone:             user.phone || null,
//         status:            user.status,
//         approval_status:   user.approval_status,
//         roles:             user.roles || [user.role],
//         resident_type:     user.resident_type || null,
//         vehicle_count:     user.vehicle_count  ?? 0,
//         occupant_count:    user.occupant_count ?? 1,
//         emergency_contact: user.emergency_contact || null,
//         flats:             userFlats,
//         flat_id:      userFlats[0]?.id           || null,
//         flat_number:  userFlats[0]?.flat_number   || null,
//         flat_type:    userFlats[0]?.flat_type     || null,
//         floor_number: userFlats[0]?.floor_number  || null,
//         block_name:   userFlats[0]?.block_name    || null,
//       };
//     });

//     res.status(200).json({
//       data,
//       pagination: {
//         currentPage: page,
//         totalPages:  Math.ceil(count / limit),
//         totalItems:  count,
//         limit,
//       },
//       totalAll: count,
//     });

//   } catch (err) {
//     console.error("Error in getResidents:", err);
//     res.status(500).json({ message: err.message });
//   }
// };


/* =====
   GET RESIDENTS (Updated with Cascading Filters)
   ===== */
const getResidents = async (req, res) => {
  try {
    const { Op } = require("sequelize");

    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || 10);
    const offset   = (page - 1) * limit;
    const search   = req.query.search?.trim() || "";
    
    // Cascading Filter Params
    const { society_id, block_id, floor_id, flat_id } = req.query;

    // 1. Filter by Society (Super Admin vs Regular Admin, supporting multi-society memberships)
    let targetSocietyId = null;
    if (req.user.activeRole === "SUPER_ADMIN" || req.user.role === "SUPER_ADMIN") {
      if (society_id) targetSocietyId = society_id;
    } else {
      targetSocietyId = req.user.society_id;
    }

    const conditions = [];

    if (targetSocietyId) {
      const userSocieties = await UserSociety.findAll({
        where: {
          society_id: targetSocietyId,
          membership_status: { [Op.ne]: "REJECTED" },
        },
        attributes: ["user_id"],
      });
      const memberIds = userSocieties.map((us) => us.user_id);
      conditions.push({
        [Op.or]: [
          { society_id: targetSocietyId },
          ...(memberIds.length > 0 ? [{ id: { [Op.in]: memberIds } }] : []),
        ],
      });
    }

    // 2. Filter by Search Query
    if (search) {
      conditions.push({
        [Op.or]: [
          { name:  { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } },
        ],
      });
    }

    const searchWhere = conditions.length > 0 ? { [Op.and]: conditions } : {};

    const allUsers = await User.findAll({
      where: searchWhere,
      order: [["name", "ASC"]],
    });

    const residentUsers = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try { rList = JSON.parse(u.roles); } catch (e) { rList = []; }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }
      return rList.includes("RESIDENT");
    });

    // Deduplicate users (in case of duplicate entries)
    const emailMap = new Map();
    residentUsers.forEach(user => {
      const key = user.email ? user.email.toLowerCase().trim() : user.id;
      if (!emailMap.has(key)) emailMap.set(key, user.toJSON());
    });

    let uniqueResidents = Array.from(emailMap.values());
    const userIds = uniqueResidents.map(u => u.id);

    // Fetch active FlatMemberships for the matched residents
    const allMemberships = await FlatMembership.findAll({
      where: { user_id: { [Op.in]: userIds }, is_current: true },
      include: [{
        model: Flat,
        attributes: ["id", "flat_number", "flat_type", "floor_id", "occupancy_status"],
        include: [
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
          },
          {
            model: Block,
            attributes: ["id", "name", "society_id"],
            required: false,
          },
        ],
      }],
    });

    // Fallback: Fetch flats directly assigned via Flat.resident_id (e.g. legacy/direct assignments)
    const directFlats = userIds.length > 0 ? await Flat.findAll({
      where: { resident_id: { [Op.in]: userIds } },
      attributes: ["id", "flat_number", "flat_type", "floor_id", "occupancy_status", "resident_id"],
      include: [
        {
          model: Floor,
          attributes: ["id", "floor_number"],
          required: false,
          include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
        },
        {
          model: Block,
          attributes: ["id", "name", "society_id"],
          required: false,
        },
      ],
    }) : [];

    // Find ALL active memberships for those flats (to identify co-occupants: owner + tenant)
    const membershipFlatIds = allMemberships.filter(m => m && m.flat_id && m.Flat).map(m => m.flat_id);
    const directFlatIds = directFlats.map(f => f?.id).filter(Boolean);
    const flatIds = [...new Set([...membershipFlatIds, ...directFlatIds])].filter(Boolean);

    const allFlatMemberships = flatIds.length > 0
      ? await FlatMembership.findAll({
          where: { flat_id: { [Op.in]: flatIds }, is_current: true },
          include: [{ model: User, attributes: ["id", "name", "email", "approval_status"] }],
        })
      : [];

    // Build occupant map: flatId → { owner: User, tenant: User }
    const flatOccupantMap = {};
    for (const fm of allFlatMemberships) {
      if (!fm || !fm.flat_id) continue;
      if (!flatOccupantMap[fm.flat_id]) flatOccupantMap[fm.flat_id] = { owner: null, tenant: null };
      if (fm.role === "OWNER" && fm.User && !flatOccupantMap[fm.flat_id].owner) {
        flatOccupantMap[fm.flat_id].owner = fm.User;
      }
      if (fm.role === "TENANT" && fm.User && !flatOccupantMap[fm.flat_id].tenant) {
        flatOccupantMap[fm.flat_id].tenant = fm.User;
      }
    }

    // 3. Apply Cascading Filters (Block / Floor / Flat)
    if (block_id || floor_id || flat_id) {
      uniqueResidents = uniqueResidents.filter(user => {
        const userMemberships = allMemberships.filter(m => m.user_id === user.id);
        const userDirectFlats = directFlats.filter(f => f && f.resident_id === user.id);
        const allUserFlats = [
          ...userMemberships.map(m => m.Flat),
          ...userDirectFlats
        ].filter(Boolean);

        return allUserFlats.some(flat => {
          const fBlockId = flat?.Floor?.Block?.id || flat?.Block?.id;
          const fFloorId = flat?.floor_id;
          const fFlatId  = flat?.id;

          let match = true;
          if (block_id && String(fBlockId) !== String(block_id)) match = false;
          if (floor_id && String(fFloorId) !== String(floor_id)) match = false;
          if (flat_id && String(fFlatId) !== String(flat_id)) match = false;

          return match;
        });
      });
    }

    const count     = uniqueResidents.length;
    const paginated = uniqueResidents.slice(offset, offset + limit);

    /* Role breakdown for the /admin/resident KPI cards. Computed from the
       fully filtered (but NOT yet paginated) list so the four values always
       agree with the rows the table is able to show, and so they follow the
       active society / search / block / floor / unit filters. Committee and
       accountant are mutually exclusive by business rule, so the three buckets
       always sum back to `total`. */
    const rolesOf = (u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) rList = [...u.roles];
      else if (typeof u.roles === "string") {
        try { rList = JSON.parse(u.roles) || []; } catch (e) { rList = []; }
      }
      if (u.role && !rList.includes(u.role)) rList.push(u.role);
      return rList;
    };
    const roleCounts = { total: count, resident: 0, committee: 0, accountant: 0 };
    uniqueResidents.forEach((u) => {
      const rList = rolesOf(u);
      if (rList.includes("COMMITTEE_MEMBER")) roleCounts.committee += 1;
      else if (rList.includes("ACCOUNTANT")) roleCounts.accountant += 1;
      else roleCounts.resident += 1;
    });

    const paginatedIds = paginated.map((u) => u.id);
    const docRecords = paginatedIds.length > 0 ? await UserDocuments.findAll({
      where: { user_id: { [Op.in]: paginatedIds } },
      attributes: ["user_id", "aadhar_url", "pan_url"],
    }) : [];
    const docMap = {};
    docRecords.forEach((d) => {
      docMap[d.user_id] = {
        aadhar_url: d.aadhar_url,
        pan_url: d.pan_url,
      };
    });

    // Query multi-society memberships for paginated residents
    const userSocieties = paginatedIds.length > 0 ? await UserSociety.findAll({
      where: {
        user_id: { [Op.in]: paginatedIds },
        membership_status: { [Op.ne]: "REJECTED" },
      },
      include: [
        { model: Society, as: "society", attributes: ["id", "name", "address"] },
        { model: UserSocietyRole, as: "societyRoles", attributes: ["role"] },
      ],
    }) : [];

    const primarySocIds = paginated.map((u) => u.society_id).filter(Boolean);
    const allSocIds = [...new Set([
      ...primarySocIds,
      ...userSocieties.map((us) => us.society_id),
    ])];
    const allSocieties = allSocIds.length > 0 ? await Society.findAll({
      where: { id: { [Op.in]: allSocIds } },
      attributes: ["id", "name", "address"],
    }) : [];
    const societyMap = {};
    allSocieties.forEach((s) => { societyMap[s.id] = s.toJSON ? s.toJSON() : s; });

    const data = paginated.map(user => {
      const userMemberships = allMemberships.filter(m => m.user_id === user.id && m.Flat);
      const userFlats = userMemberships.map(m => {
        const flat = m.Flat;
        if (!flat || !flat.id) return null;
        const occupants = flatOccupantMap[flat.id] || {};
        const bSocId = flat.Floor?.Block?.society_id || flat.Block?.society_id || user.society_id;
        return {
          id:           flat.id,
          flat_id:      flat.id,
          flat_number:  flat.flat_number,
          flat_type:    flat.flat_type,
          floor_id:     flat.floor_id,
          Floor: flat.Floor ? {
            id:           flat.Floor.id,
            floor_number: flat.Floor.floor_number,
            Block: flat.Floor.Block ? { id: flat.Floor.Block.id, name: flat.Floor.Block.name, society_id: flat.Floor.Block.society_id } : null,
          } : null,
          Block: flat.Block ? { id: flat.Block.id, name: flat.Block.name, society_id: flat.Block.society_id } : null,
          society_id:   bSocId || null,
          society_name: societyMap[bSocId]?.name || null,
          floor_number: flat.Floor?.floor_number ?? null,
          block_name:   flat.Floor?.Block?.name || flat.Block?.name || null,
          owner:  occupants.owner  ? { id: occupants.owner.id,  name: occupants.owner.name }  : null,
          tenant: occupants.tenant ? { id: occupants.tenant.id, name: occupants.tenant.name, approval_status: occupants.tenant.approval_status } : null,
        };
      }).filter(Boolean);

      // Fallback: Append direct flats if not already in userMemberships
      const existingFlatIds = new Set(userFlats.map(f => f.id));
      directFlats.filter(f => f && f.resident_id === user.id && f.id).forEach(flat => {
        if (!existingFlatIds.has(flat.id)) {
          const occupants = flatOccupantMap[flat.id] || {};
          const bSocId = flat.Floor?.Block?.society_id || flat.Block?.society_id || user.society_id;
          userFlats.push({
            id:           flat.id,
            flat_id:      flat.id,
            flat_number:  flat.flat_number,
            flat_type:    flat.flat_type,
            floor_id:     flat.floor_id,
            Floor: flat.Floor ? {
              id:           flat.Floor.id,
              floor_number: flat.Floor.floor_number,
              Block: flat.Floor.Block ? { id: flat.Floor.Block.id, name: flat.Floor.Block.name, society_id: flat.Floor.Block.society_id } : null,
            } : null,
            Block: flat.Block ? { id: flat.Block.id, name: flat.Block.name, society_id: flat.Block.society_id } : null,
            society_id:   bSocId || null,
            society_name: societyMap[bSocId]?.name || null,
            floor_number: flat.Floor?.floor_number ?? null,
            block_name:   flat.Floor?.Block?.name || flat.Block?.name || null,
            owner:        occupants.owner ? { id: occupants.owner.id, name: occupants.owner.name } : { id: user.id, name: user.name },
            tenant:       occupants.tenant ? { id: occupants.tenant.id, name: occupants.tenant.name, approval_status: occupants.tenant.approval_status } : null,
          });
          existingFlatIds.add(flat.id);
        }
      });

      // Build user's societies list
      const userSocRecords = userSocieties.filter((us) => us.user_id === user.id);
      const userSocMap = new Map();
      userSocRecords.forEach((us) => {
        const soc = us.society || societyMap[us.society_id];
        if (soc) {
          const sRoles = (us.societyRoles || []).map((r) => r.role);
          userSocMap.set(soc.id, {
            id: soc.id,
            name: soc.name,
            address: soc.address,
            membership_status: us.membership_status,
            is_default: us.is_default,
            roles: sRoles.length > 0 ? sRoles : (us.resident_type ? [us.resident_type] : ["RESIDENT"]),
            flats: [],
          });
        }
      });

      if (user.society_id && societyMap[user.society_id] && !userSocMap.has(user.society_id)) {
        const s = societyMap[user.society_id];
        userSocMap.set(s.id, {
          id: s.id,
          name: s.name,
          address: s.address,
          membership_status: "ACTIVE",
          is_default: true,
          flats: [],
        });
      }

      // Link flats to user's societies
      userFlats.forEach((f) => {
        const bSocId = f.society_id || user.society_id;
        if (bSocId && userSocMap.has(bSocId)) {
          userSocMap.get(bSocId).flats.push({
            id: f.id,
            flat_number: f.flat_number,
            flat_type: f.flat_type,
            floor_number: f.floor_number,
            block_name: f.block_name,
            role: user.resident_type || "OWNER",
          });
        }
      });

      const userSocietiesList = Array.from(userSocMap.values());
      const primarySociety = userSocMap.get(user.society_id) || userSocietiesList[0] || null;

      // If requester is a Society Admin (or scoped to targetSocietyId),
      // only show the data, flats, and roles for that specific society!
      const isSuperAdminNoFilter = req.user.role === "SUPER_ADMIN" && !targetSocietyId;

      let scopedSocieties = userSocietiesList;
      let scopedFlats = userFlats;
      let scopedRoles = user.roles || [user.role];
      let scopedPrimarySoc = primarySociety;

      const targetSocietyNum = targetSocietyId ? Number(targetSocietyId) : null;

      if (!isSuperAdminNoFilter && targetSocietyNum) {
        scopedSocieties = userSocietiesList.filter((s) => Number(s.id) === targetSocietyNum);
        scopedFlats = userFlats.filter((f) => Number(f.society_id) === targetSocietyNum);
        const thisSoc = userSocMap.get(targetSocietyNum);
        if (thisSoc && Array.isArray(thisSoc.roles) && thisSoc.roles.length > 0) {
          scopedRoles = thisSoc.roles;
        } else {
          scopedRoles = ["RESIDENT"];
        }
        if (thisSoc) scopedPrimarySoc = thisSoc;
      }

      // Determine society-scoped or overall approval status
      const targetSocRecord = targetSocietyNum ? userSocMap.get(targetSocietyNum) : null;
      let effectiveApprovalStatus = user.approval_status;
      let effectiveStatus = user.status;

      if (targetSocRecord) {
        if (targetSocRecord.membership_status === "PENDING") {
          effectiveApprovalStatus = "PENDING";
          effectiveStatus = "PENDING";
        } else if (targetSocRecord.membership_status === "ACTIVE") {
          effectiveApprovalStatus = "APPROVED";
          effectiveStatus = "ACTIVE";
        } else if (targetSocRecord.membership_status === "REJECTED") {
          effectiveApprovalStatus = "REJECTED";
          effectiveStatus = "INACTIVE";
        }
      }

      // If viewing a specific society, only flag pending approval if pending in THIS society.
      // If super admin viewing across all societies (no targetSocietyNum), flag if any society or user itself is pending.
      const hasPendingMembership = targetSocietyNum
        ? (targetSocRecord ? targetSocRecord.membership_status === "PENDING" : user.approval_status === "PENDING")
        : (userSocietiesList.some((s) => s.membership_status === "PENDING") || user.approval_status === "PENDING");

      return {
        id:                user.id,
        name:              user.name,
        email:             user.email,
        phone:             user.phone || null,
        // The list UI renders an avatar beside the name (UserAvatar), which
        // falls back to initials whenever this is missing. The findAll above
        // selects every column, so the value is on the model - it just has to
        // be forwarded here.
        profile_picture:   user.profile_picture || null,
        status:            effectiveStatus,
        approval_status:   effectiveApprovalStatus,
        has_pending_approval: hasPendingMembership,
        roles:             scopedRoles,
        resident_type:     user.resident_type || null,
        vehicle_count:     user.vehicle_count  ?? 0,
        occupant_count:    user.occupant_count ?? 1,
        emergency_contact: user.emergency_contact || null,
        documents:         docMap[user.id] || null,
        society_id:        targetSocietyId || user.society_id,
        societies:         scopedSocieties,
        society_name:      scopedPrimarySoc?.name || (scopedSocieties.map((s) => s.name).join(", ") || null),
        flats:             scopedFlats,
        flat_id:      scopedFlats[0]?.id           || null,
        flat_number:  scopedFlats[0]?.flat_number   || null,
        flat_type:    scopedFlats[0]?.flat_type     || null,
        floor_number: scopedFlats[0]?.floor_number  || null,
        block_name:   scopedFlats[0]?.block_name    || null,
      };
    });

    res.status(200).json({
      data,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      totalAll: count,
      roleCounts,
    });

  } catch (err) {
    console.error("Error in getResidents:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   UPDATE RESIDENT
   ===== */
const updateResident = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name, phone, resident_type,
      flat_id, flat_type,
      old_flat_id,
      parking_slot_id,
      revoke_parking_slot,
      revoke_flat_id,
      vehicle_count, occupant_count, emergency_contact,
    } = normaliseMultipartBody(req.body);

    const resident = await User.findByPk(id);
    if (!resident) return res.status(404).json({ message: "Resident not found" });
    if (!(resident.roles || [resident.role]).includes("RESIDENT"))
      return res.status(404).json({ message: "Resident not found" });

    if (emergency_contact && (!emergency_contact.name || !emergency_contact.phone)) {
      return res.status(400).json({ message: "emergency_contact must include both name and phone." });
    }

    // Editing other profile fields on a rejected resident is fine, but moving
    // them into a flat is not.
    if (flat_id) {
      const assignable = await ensureAssignable(resident.id);
      if (!assignable.ok) return res.status(assignable.status).json(assignable.payload);
    }

    const userUpdatePayload = {};
    if (name) userUpdatePayload.name = name;
    if (phone !== undefined) userUpdatePayload.phone = phone || null;
    if (resident_type) userUpdatePayload.resident_type = resident_type;
    if (vehicle_count  != null) userUpdatePayload.vehicle_count  = Number(vehicle_count);
    if (occupant_count != null) userUpdatePayload.occupant_count = Number(occupant_count);
    if (emergency_contact !== undefined) {
      userUpdatePayload.emergency_contact = emergency_contact || null;
    }

    if (req.file) {
      const pic = readUploadedProfilePicture(req.file);
      if (pic?.url) {
        if (resident.profile_picture_public_id) {
          destroyProfilePicture(resident.profile_picture_public_id).catch(() => {});
        }
        userUpdatePayload.profile_picture = pic.url;
        userUpdatePayload.profile_picture_public_id = pic.publicId;
      }
    }

    await resident.update(userUpdatePayload);

    if (flat_id) {
      const oldFlat = old_flat_id
        ? await Flat.findOne({ where: { id: old_flat_id, resident_id: resident.id } })
        : await Flat.findOne({ where: { resident_id: resident.id } });

      if (oldFlat && String(oldFlat.id) !== String(flat_id)) {
        await ParkingSlot.update(
          { resident_id: null, flat_id: null, status: "AVAILABLE" },
          { where: { flat_id: oldFlat.id, status: "ASSIGNED" } }
        );
        await oldFlat.update({ resident_id: null, occupancy_status: "VACANT" });
        await ResidentHistory.update(
          { move_out_date: new Date(), is_current: false },
          { where: { flat_id: oldFlat.id, user_id: resident.id, is_current: true } }
        );
      }

      if (!oldFlat || String(oldFlat.id) !== String(flat_id)) {
        await ResidentHistory.update(
          { move_out_date: new Date(), is_current: false },
          { where: { flat_id, is_current: true } }
        );
        await ResidentHistory.create({
          flat_id,
          user_id: resident.id,
          move_in_date: new Date(),
          is_current: true,
        });
        const targetFlat = await Flat.findByPk(flat_id, {
          include: [
            {
              model: Floor,
              attributes: ["id", "floor_number"],
              include: [{ model: Block, attributes: ["id", "society_id"] }],
            },
            {
              model: Block,
              attributes: ["id", "society_id"],
            },
          ],
        });
        const flatUpdatePayload = {
          resident_id: resident.id,
          occupancy_status: resident_type === "TENANT" ? "RENTED" : "OWNER_OCCUPIED",
        };
        // Routine resident update must not overwrite configured BHK; legacy fallback only for unconfigured flats
        if (!targetFlat?.flat_type && flat_type && ["1BHK", "2BHK", "3BHK"].includes(flat_type)) {
          flatUpdatePayload.flat_type = flat_type;
        }
        await Flat.update(flatUpdatePayload, { where: { id: flat_id } });

        const targetSocId =
          targetFlat?.Block?.society_id ||
          targetFlat?.Floor?.Block?.society_id ||
          req.headers["x-society-id"];

        if (targetSocId) {
          if (resident.society_id) {
            const [origSoc] = await UserSociety.findOrCreate({
              where: { user_id: resident.id, society_id: resident.society_id },
              defaults: {
                membership_status: "ACTIVE",
                resident_type: resident.resident_type || "OWNER",
                occupant_count: resident.occupant_count || 1,
                vehicle_count: resident.vehicle_count || 0,
                emergency_contact: resident.emergency_contact || null,
                source: "MIGRATED",
                is_default: true,
              },
            });
            if (origSoc.membership_status !== "ACTIVE") {
              await origSoc.update({ membership_status: "ACTIVE" });
            }
            await UserSocietyRole.findOrCreate({
              where: { user_society_id: origSoc.id, role: "RESIDENT" },
              defaults: { user_society_id: origSoc.id, role: "RESIDENT" },
            });
          }

          const [userSociety] = await UserSociety.findOrCreate({
            where: {
              user_id: resident.id,
              society_id: targetSocId,
            },
            defaults: {
              membership_status: "ACTIVE",
              resident_type: resident_type || "OWNER",
              source: "ADMIN_ASSIGNED",
              is_default: !resident.society_id,
            },
          });
          if (userSociety.membership_status !== "ACTIVE") {
            await userSociety.update({ membership_status: "ACTIVE" });
          }
          await UserSocietyRole.findOrCreate({
            where: {
              user_society_id: userSociety.id,
              role: "RESIDENT",
            },
            defaults: {
              user_society_id: userSociety.id,
              role: "RESIDENT",
            },
          });
        }

        await FlatMembership.update(
          { is_current: false, move_out_date: new Date() },
          { where: { flat_id, is_current: true } }
        );
        await FlatMembership.create({
          flat_id,
          user_id: resident.id,
          society_id: targetSocId || null,
          role: resident_type || "OWNER",
          is_staying: true,
          pays_maintenance: true,
          move_in_date: new Date(),
          is_current: true,
        });
      }
      // Routine resident profile update must never mutate a flat's BHK
    }

    if (parking_slot_id) {
      await ParkingSlot.update(
        { resident_id: null, flat_id: null, status: "AVAILABLE" },
        { where: { resident_id: resident.id, status: "ASSIGNED" } }
      );

      const currentFlat = flat_id
        ? { id: flat_id }
        : old_flat_id
          ? { id: old_flat_id }
          : await Flat.findOne({ where: { resident_id: resident.id }, attributes: ["id"] });

      await ParkingSlot.update(
        {
          resident_id: resident.id,
          flat_id: currentFlat?.id || null,
          status: "ASSIGNED",
        },
        { where: { id: parking_slot_id } }
      );
    } else if (revoke_parking_slot) {
      const targetFlatId = revoke_flat_id || null;
      const whereClause = targetFlatId
        ? { flat_id: targetFlatId, status: "ASSIGNED" }
        : { resident_id: resident.id, status: "ASSIGNED" };
      await ParkingSlot.update(
        { resident_id: null, flat_id: null, status: "AVAILABLE" },
        { where: whereClause }
      );
    }

    res.json({ message: "Resident updated successfully" });
  } catch (err) {
    console.error("[updateResident]", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   DELETE RESIDENT
   ===== */
const deleteResident = async (req, res) => {
  try {
    const { id } = req.params;
    const resident = await User.findByPk(id);
    if (!resident) return res.status(404).json({ message: "Resident not found" });
    if (!(resident.roles || [resident.role]).includes("RESIDENT"))
      return res.status(404).json({ message: "Resident not found" });

    const flat = await Flat.findOne({ where: { resident_id: id } });
    if (flat) {
      const pendingBill = await Bill.findOne({ where: { flat_id: flat.id, status: "PENDING" } });
      if (pendingBill)
        return res.status(400).json({ message: "Pending bills must be cleared first" });
      await Promise.all([
        HouseHoldMember.destroy({ where: { flat_id: flat.id } }),
        flat.update({ resident_id: null }),
      ]);
    }

    await Promise.all([
      ParkingRequest.destroy({ where: { resident_id: id } }),
      notificationService.deleteUserNotifications(id),
    ]);

    await resident.destroy();
    res.json({ message: "Resident deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   TOGGLE RESIDENT STATUS (DEACTIVATE / REACTIVATE)
   Non-destructive: flips User.status between ACTIVE and INACTIVE so the
   resident can no longer sign in. Flats, memberships, bills and history are
   left fully intact so the record can be restored without data confusion.
   ===== */
const toggleResidentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const resident = await User.findByPk(id);
    if (!resident) return res.status(404).json({ message: "Resident not found" });
    if (!(resident.roles || [resident.role]).includes("RESIDENT"))
      return res.status(404).json({ message: "Resident not found" });

    const requested = String(req.body?.status || "").toUpperCase();
    const newStatus = requested === "ACTIVE" || requested === "INACTIVE"
      ? requested
      : (resident.status === "INACTIVE" ? "ACTIVE" : "INACTIVE");

    if (newStatus === "INACTIVE") {
      await resident.update({ status: "INACTIVE", fcm_token: null });

      // Best-effort: let the resident know their access was revoked.
      try {
        await notificationService.sendNotification({
          societyId: resident.society_id,
          receiverUserId: resident.id,
          senderUserId: req.user?.id,
          receiverRole: "RESIDENT",
          title: "Account Deactivated",
          message: "Your resident account has been deactivated by the society admin. Please contact the society office for assistance.",
          type: "SYSTEM",
          sourceEventId: `RESIDENT_DEACTIVATED:${resident.id}:${Date.now()}`,
        });
      } catch (notifyErr) {
        console.error("Resident deactivate notification failed:", notifyErr.message);
      }

      return res.json({ message: "Resident deactivated successfully", status: "INACTIVE" });
    }

    await resident.update({ status: "ACTIVE" });
    res.json({ message: "Resident reactivated successfully", status: "ACTIVE" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET UNASSIGNED RESIDENTS
   ===== */
const getUnassignedResidents = async (req, res) => {
  try {
    const rawSocietyId = req.headers["x-society-id"] || req.query.society_id;
    const targetSocietyId =
      req.user?.role === "SUPER_ADMIN" || req.user?.activeRole === "SUPER_ADMIN"
        ? rawSocietyId || req.user?.society_id
        : req.user?.society_id;

    const conditions = [{ status: "ACTIVE" }];

    if (targetSocietyId) {
      const userSocieties = await UserSociety.findAll({
        where: {
          society_id: targetSocietyId,
          membership_status: { [Op.ne]: "REJECTED" },
        },
        attributes: ["user_id"],
      });
      const memberIds = userSocieties.map((us) => us.user_id);
      conditions.push({
        [Op.or]: [
          { society_id: targetSocietyId },
          ...(memberIds.length > 0 ? [{ id: { [Op.in]: memberIds } }] : []),
        ],
      });
    }

    const allUsers = await User.findAll({
      where: { [Op.and]: conditions },
      attributes: ["id", "name", "role", "roles", "resident_type"],
      include: { model: Flat, required: false },
    });

    const unassigned = allUsers.filter((u) =>
      (u.roles || [u.role]).includes("RESIDENT") &&
      !u.Flat &&
      u.resident_type !== "TENANT"
    );

    res.json(unassigned.map((u) => ({ id: u.id, name: u.name })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET MY FLAT
   Returns an array of all flats the user is associated with,
   via FlatMembership (owners/tenants) and HouseHoldMember (family).

   ✅ FIX: Added fallback (Step 3) to check Flat.resident_id directly
   in case FlatMembership rows are missing (e.g. legacy/old records).
   ===== */
const getMyFlat = async (req, res) => {
  try {
    const userId = req.user.id;
    const activeSocietyId = req.query.all === "1" || req.query.all === "true"
      ? null
      : (req.query.society_id ? parseInt(req.query.society_id, 10) : (req.user?.society_id ? parseInt(req.user.society_id, 10) : null));

    const user = await User.findByPk(userId, { attributes: ["id", "name"] });
    if (!user) return res.status(404).json({ message: "User not found" });

    const flatsList = [];
    const addedFlatIds = new Set();

    // ===
    // 1. PRIMARY MEMBERSHIPS (Owner / Tenant)
    //    Fetch all active memberships (is_current = true).
    // ===
    const memberships = await FlatMembership.findAll({
      where: { user_id: userId, is_current: true },
      include: [{
        model: Flat,
        attributes: ["id", "flat_number", "occupancy_status", "block_id", "floor_id"],
        include: [
          { model: Block, attributes: ["id", "name", "society_id"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
          },
        ],
      }],
    });

    for (const m of memberships) {
      if (m.Flat && !addedFlatIds.has(m.flat_id)) {
        const flat = m.Flat;
        const flatSocietyId = flat?.Floor?.Block?.society_id || flat?.Block?.society_id || null;
        if (activeSocietyId && flatSocietyId && flatSocietyId !== activeSocietyId) {
          continue; // Skip flats from other societies
        }

        const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
        const floorNumber = flat?.Floor?.floor_number ?? null;

        flatsList.push({
          user_id:      user.id,
          user_name:    user.name,
          flat_id:      flat.id,
          flat_number:  flat.flat_number || null,
          block_name:   blockName,
          floor_number: floorNumber,
          society_id:   flatSocietyId,
          isAdmin:      true,
          role:         m.role,
          occupancy_status: flat.occupancy_status,
        });
        addedFlatIds.add(m.flat_id);
      }
    }

    // ===
    // 2. HOUSEHOLD MEMBERS (Family Members)
    // ===
    const householdMembers = await HouseHoldMember.findAll({
      where: { user_id: userId },
      include: [{
        model: Flat,
        attributes: ["id", "flat_number", "occupancy_status", "block_id", "floor_id"],
        include: [
          { model: Block, attributes: ["id", "name", "society_id"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
          },
        ],
      }],
    });

    for (const hm of householdMembers) {
      if (hm.Flat && !addedFlatIds.has(hm.flat_id)) {
        const flat = hm.Flat;
        const flatSocietyId = flat?.Floor?.Block?.society_id || flat?.Block?.society_id || null;
        if (activeSocietyId && flatSocietyId && flatSocietyId !== activeSocietyId) {
          continue;
        }

        const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
        const floorNumber = flat?.Floor?.floor_number ?? null;

        flatsList.push({
          user_id:      user.id,
          user_name:    user.name,
          flat_id:      flat.id,
          flat_number:  flat.flat_number || null,
          block_name:   blockName,
          floor_number: floorNumber,
          society_id:   flatSocietyId,
          isAdmin:      hm.isAdmin,
          role:         "FAMILY_MEMBER",
          occupancy_status: flat.occupancy_status,
        });
        addedFlatIds.add(hm.flat_id);
      }
    }

    // ===
    // 3. ✅ FALLBACK: Direct Flat.resident_id assignment
    //    Catches residents created without a FlatMembership row,
    //    or legacy records where FlatMembership is missing/stale.
    // ===
    if (flatsList.length === 0) {
      const directFlats = await Flat.findAll({
        where: { resident_id: userId },
        include: [
          { model: Block, attributes: ["id", "name", "society_id"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }],
          },
        ],
      });

      for (const flat of directFlats) {
        if (!addedFlatIds.has(flat.id)) {
          const flatSocietyId = flat?.Floor?.Block?.society_id || flat?.Block?.society_id || null;
          if (activeSocietyId && flatSocietyId && flatSocietyId !== activeSocietyId) {
            continue;
          }

          const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
          const floorNumber = flat?.Floor?.floor_number ?? null;

          flatsList.push({
            user_id:          user.id,
            user_name:        user.name,
            flat_id:          flat.id,
            flat_number:      flat.flat_number || null,
            block_name:       blockName,
            floor_number:     floorNumber,
            society_id:       flatSocietyId,
            isAdmin:          true,
            role:             "OWNER",
            occupancy_status: flat.occupancy_status,
          });
          addedFlatIds.add(flat.id);
        }
      }
    }

    // ===
    // 4. ENRICH: Add tenant info + effective occupancy for each flat.
    //    A moved-out tenant must not keep the flat marked as rented, otherwise
    //    owners are permanently blocked from generating gate passes.
    // ===
    if (flatsList.length > 0) {
      const allFlatIds = flatsList.map(f => f.flat_id);
      const occupancy = await getOccupancyContextForFlats(allFlatIds);

      for (const flat of flatsList) {
        const ctx = occupancy.get(Number(flat.flat_id));
        if (!ctx) continue;

        const tenantM = ctx.activeTenant;
        flat.tenant = tenantM && tenantM.User
          ? { id: tenantM.User.id, name: tenantM.User.name, email: tenantM.User.email, approval_status: tenantM.User.approval_status }
          : null;
        flat.occupancy_status = ctx.occupancyStatus;
      }
    }

    return res.json(flatsList);

  } catch (error) {
    console.error("[getMyFlat]", error);
    res.status(500).json({ message: error.message });
  }
};

/* =====
   ACCOUNTANT — CREATE (EXTERNAL)
   ===== */
const createAccountant = async (req, res) => {
  try {
    const { name, email, password, phone, society_id } = req.body;

    const safePassword = password || "Admin@123";
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phone || !phoneRegex.test(phone.replace(/\s/g, ""))) {
      return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }

    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";
    let targetSocietyId = req.user.society_id;
    if (isSuperAdmin && society_id) targetSocietyId = society_id;

    if (!targetSocietyId) {
      return res.status(400).json({ message: "Society ID is required" });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "A user with this email already exists." });
    }

    const hashed = await bcrypt.hash(safePassword, 8);
    const uploadedPhoto = req.file ? readUploadedProfilePicture(req.file) : null;
    const accountant = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: "ACCOUNTANT",
      roles: ["ACCOUNTANT"],
      society_id: targetSocietyId,
      status: "ACTIVE",
      approval_status: "APPROVED",
      profile_picture: uploadedPhoto ? uploadedPhoto.url : (req.body.profile_picture || null),
      profile_picture_public_id: uploadedPhoto ? uploadedPhoto.publicId : null,
    });

    const assignment = await AccountantAssignment.create({
      user_id: accountant.id,
      society_id: targetSocietyId,
      is_society_resident: false,
      start_date: new Date(),
      status: "ACTIVE",
      appointed_by: req.user.id,
    });

    const society = await Society.findByPk(targetSocietyId);
    sendAccountantWelcomeEmail(email, name, safePassword, society?.name || "your society")
      .catch((err) => console.error("[Mailer] Accountant welcome email failed:", err.message));

    res.status(201).json({
      id: assignment.id,
      user_id: accountant.id,
      name: accountant.name,
      email: accountant.email,
      phone: accountant.phone,
      role: accountant.role,
      roles: accountant.roles,
      society_id: targetSocietyId,
      societyName: society?.name || "NA",
      profile_picture: accountant.profile_picture || null,
      from_society: false,
      start_date: assignment.start_date,
      inactive_date: assignment.inactive_date,
      status: assignment.status,
      assignment_id: assignment.id,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — APPOINT FROM SOCIETY RESIDENTS
   ===== */
const appointResidentAccountant = async (req, res) => {
  try {
    const { resident_id, society_id } = req.body;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";
    let targetSocietyId = req.user.society_id;
    if (isSuperAdmin && society_id) targetSocietyId = society_id;

    if (!resident_id) {
      return res.status(400).json({ message: "Resident ID is required." });
    }
    if (!targetSocietyId) {
      return res.status(400).json({ message: "Society ID is required." });
    }

    const resident = await User.findByPk(resident_id);
    if (!resident) {
      return res.status(404).json({ message: "Resident not found." });
    }

    if (resident.society_id !== parseInt(targetSocietyId, 10)) {
      return res.status(400).json({ message: "Resident does not belong to the selected society." });
    }

    const roles = Array.isArray(resident.roles) && resident.roles.length > 0 ? [...resident.roles] : [resident.role];

    // A rejected registration must be re-approved before it can hold a role.
    const notRejected = await ensureNotRejected(resident_id);
    if (!notRejected.ok) return res.status(notRejected.status).json(notRejected.payload);

    // Rule: Cannot be Admin
    if (roles.includes("SOCIETY_ADMIN") || roles.includes("SUPER_ADMIN")) {
      return res.status(400).json({ message: "Society Admins cannot be appointed as Accountant." });
    }

    // Rule: A resident can only be an accountant or committee member, not both at the same time
    if (roles.includes("COMMITTEE_MEMBER") || resident.role === "COMMITTEE_MEMBER") {
      return res.status(400).json({
        message: "Resident is a Committee Member. A resident can only be an Accountant or Committee Member, not both simultaneously.",
      });
    }

    // Check if already active accountant
    const existingActiveAssignment = await AccountantAssignment.findOne({
      where: { user_id: resident.id, society_id: targetSocietyId, status: "ACTIVE" },
    });
    if (existingActiveAssignment && roles.includes("ACCOUNTANT")) {
      return res.status(400).json({ message: "Resident is already an active Accountant in this society." });
    }

    if (!roles.includes("ACCOUNTANT")) roles.push("ACCOUNTANT");
    if (!roles.includes("RESIDENT")) roles.push("RESIDENT");

    await resident.update({ roles });

    let assignment = await AccountantAssignment.findOne({
      where: { user_id: resident.id, society_id: targetSocietyId },
    });
    if (assignment) {
      await assignment.update({
        status: "ACTIVE",
        start_date: new Date(),
        inactive_date: null,
        appointed_by: req.user.id,
      });
    } else {
      assignment = await AccountantAssignment.create({
        user_id: resident.id,
        society_id: targetSocietyId,
        is_society_resident: true,
        start_date: new Date(),
        status: "ACTIVE",
        appointed_by: req.user.id,
      });
    }

    const society = await Society.findByPk(targetSocietyId);

    res.status(201).json({
      id: assignment.id,
      user_id: resident.id,
      name: resident.name,
      email: resident.email,
      phone: resident.phone,
      role: resident.role,
      roles: resident.roles,
      society_id: targetSocietyId,
      societyName: society?.name || "NA",
      from_society: true,
      start_date: assignment.start_date,
      inactive_date: assignment.inactive_date,
      status: assignment.status,
      assignment_id: assignment.id,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — GET ELIGIBLE RESIDENTS FOR APPOINTMENT
   ===== */
const getEligibleAccountantResidents = async (req, res) => {
  try {
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";
    const { society_id } = req.query;

    let targetSocietyId = req.user.society_id;
    if (isSuperAdmin && society_id && society_id !== "ALL") targetSocietyId = parseInt(society_id, 10);
    else if (targetSocietyId) targetSocietyId = parseInt(targetSocietyId, 10);

    if (!targetSocietyId) {
      return res.json([]);
    }

    const allUsers = await User.findAll({
      where: {
        society_id: targetSocietyId,
      },
      order: [["name", "ASC"]],
    });

    const userIds = allUsers.map((u) => u.id);

    // Fetch active FlatMemberships to display flat numbers
    const memberships = await FlatMembership.findAll({
      where: { user_id: { [Op.in]: userIds }, is_current: true },
      include: [
        {
          model: Flat,
          attributes: ["id", "flat_number", "block_id", "floor_id"],
          include: [{ model: Block, attributes: ["id", "name"], required: false }],
          required: false,
        },
      ],
    });

    const flatMap = new Map();
    memberships.forEach((m) => {
      if (m.Flat && !flatMap.has(m.user_id)) {
        flatMap.set(m.user_id, {
          flat_number: m.Flat.flat_number,
          block_name: m.Flat.Block?.name || null,
        });
      }
    });

    // Also get active accountant assignment user IDs
    const activeAssignments = await AccountantAssignment.findAll({
      where: {
        society_id: targetSocietyId,
        status: "ACTIVE",
      },
      attributes: ["user_id"],
    });
    const activeAccountantUserIds = new Set(activeAssignments.map((a) => a.user_id));

    // Filter eligible: Resident, NOT admin, NOT committee member, NOT active accountant
    const eligible = allUsers.filter((u) => {
      let rList = [];
      if (Array.isArray(u.roles) && u.roles.length > 0) {
        rList = u.roles;
      } else if (typeof u.roles === "string") {
        try { rList = JSON.parse(u.roles); } catch (e) { rList = []; }
      }
      if (u.role && !rList.includes(u.role)) {
        rList.push(u.role);
      }

      const isRes = rList.includes("RESIDENT") || u.role === "RESIDENT";
      const isAdmin = rList.includes("SOCIETY_ADMIN") || rList.includes("SUPER_ADMIN") || u.role === "SOCIETY_ADMIN" || u.role === "SUPER_ADMIN";
      const isCommittee = rList.includes("COMMITTEE_MEMBER") || u.role === "COMMITTEE_MEMBER";
      const isAccountant = rList.includes("ACCOUNTANT") || u.role === "ACCOUNTANT" || activeAccountantUserIds.has(u.id);

      return isRes && !isAdmin && !isCommittee && !isAccountant;
    });

    // Deduplicate users (in case of multiple records with same email)
    const seen = new Set();
    const uniqueEligible = [];
    for (const u of eligible) {
      const key = u.email ? u.email.toLowerCase().trim() : u.id;
      if (!seen.has(key)) {
        seen.add(key);
        const fInfo = flatMap.get(u.id);
        uniqueEligible.push({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          resident_type: u.resident_type,
          flat_number: fInfo?.flat_number || null,
          block_name: fInfo?.block_name || null,
        });
      }
    }

    res.json(uniqueEligible);
  } catch (err) {
    console.error("getEligibleAccountantResidents error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — GET ALL ACCOUNTANTS (LIST)
   ===== */
const getAccountant = async (req, res) => {
  try {
    const { society_id } = req.query;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    const where = {};
    if (isSuperAdmin) {
      if (society_id && society_id !== "ALL") where.society_id = society_id;
    } else {
      where.society_id = req.user.society_id;
    }

    const assignments = await AccountantAssignment.findAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "role", "roles", "status", "profile_picture"],
          required: true,
        },
        {
          model: Society,
          as: "society",
          attributes: ["id", "name"],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const userWhere = { ...where };
    const allUsers = await User.findAll({
      where: userWhere,
      attributes: ["id", "name", "email", "phone", "role", "roles", "society_id", "status", "profile_picture", "created_at"],
      include: [{ model: Society, attributes: ["id", "name"], required: false }],
    });

    const assignmentUserIds = new Set(assignments.map((a) => a.user_id));
    const legacyAccountants = allUsers.filter(
      (u) =>
        ((Array.isArray(u.roles) && u.roles.includes("ACCOUNTANT")) || u.role === "ACCOUNTANT") &&
        !assignmentUserIds.has(u.id)
    );

    const list = [
      ...assignments.map((a) => ({
        id: a.user?.id || a.id,
        assignment_id: a.id,
        user_id: a.user?.id,
        name: a.user?.name || "Unknown",
        email: a.user?.email || "—",
        phone: a.user?.phone || null,
        role: a.user?.role,
        roles: a.user?.roles || [],
        society_id: a.society_id,
        societyName: a.society?.name || "NA",
        profile_picture: a.user?.profile_picture || null,
        from_society: Boolean(a.is_society_resident),
        start_date: a.start_date,
        inactive_date: a.inactive_date,
        status: a.status,
      })),
      ...legacyAccountants.map((u) => ({
        id: u.id,
        assignment_id: null,
        user_id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        roles: u.roles || [],
        society_id: u.society_id,
        societyName: u.Society?.name || "NA",
        profile_picture: u.profile_picture || null,
        from_society: Boolean((u.roles || []).includes("RESIDENT") || u.role === "RESIDENT"),
        start_date: u.created_at,
        inactive_date: u.status === "INACTIVE" ? u.created_at : null,
        status: u.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      })),
    ];

    res.json(list);
  } catch (err) {
    console.error("getAccountant error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — UPDATE DETAILS
   ===== */
const updateAccountant = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const targetId = req.params.id;

    if (phone) {
      const phoneRegex = /^[6-9]\d{9}$/;
      if (!phoneRegex.test(phone.replace(/\s/g, "")))
        return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }

    let user = await User.findByPk(targetId);
    if (!user) {
      const assignment = await AccountantAssignment.findByPk(targetId);
      if (assignment) {
        user = await User.findByPk(assignment.user_id);
      }
    }
    if (!user) return res.status(404).json({ message: "Accountant not found" });

    const uploadedPhoto = req.file ? readUploadedProfilePicture(req.file) : null;
    const updatePayload = {
      ...(name && { name }),
      ...(phone && { phone }),
      ...(uploadedPhoto && { profile_picture: uploadedPhoto.url, profile_picture_public_id: uploadedPhoto.publicId }),
      ...(req.body.profile_picture && !uploadedPhoto && { profile_picture: req.body.profile_picture }),
    };

    await user.update(updatePayload);
    res.json({ message: "Accountant updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — TOGGLE STATUS (DISABLE / MAKE INACTIVE / REACTIVATE)
   ===== */
const toggleAccountantStatus = async (req, res) => {
  try {
    const targetId = req.params.id;
    const { status } = req.body;

    let assignment = await AccountantAssignment.findOne({
      where: {
        [Op.or]: [{ id: targetId }, { user_id: targetId }],
      },
    });

    let user = null;
    if (assignment) {
      user = await User.findByPk(assignment.user_id);
    } else {
      user = await User.findByPk(targetId);
      if (user) {
        const isRes = Boolean((user.roles || []).includes("RESIDENT") || user.role === "RESIDENT");
        assignment = await AccountantAssignment.create({
          user_id: user.id,
          society_id: user.society_id,
          is_society_resident: isRes,
          start_date: user.created_at || new Date(),
          status: user.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        });
      }
    }

    if (!assignment || !user) {
      return res.status(404).json({ message: "Accountant assignment not found" });
    }

    const newStatus = status || (assignment.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");

    if (newStatus === "INACTIVE") {
      await assignment.update({
        status: "INACTIVE",
        inactive_date: new Date(),
      });

      if (assignment.is_society_resident) {
        // DO NOT touch user general status; only remove ACCOUNTANT from roles
        let roles = Array.isArray(user.roles) ? [...user.roles] : [user.role];
        roles = roles.filter((r) => r !== "ACCOUNTANT");
        if (!roles.includes("RESIDENT")) roles.push("RESIDENT");
        const nextRole = user.role === "ACCOUNTANT" ? "RESIDENT" : user.role;
        await user.update({ roles, role: nextRole });
      } else {
        await user.update({ status: "INACTIVE" });
      }

      return res.json({
        message: "Accountant deactivated successfully",
        status: "INACTIVE",
        inactive_date: assignment.inactive_date,
      });
    } else {
      // Activating
      if (assignment.is_society_resident) {
        const roles = Array.isArray(user.roles) ? [...user.roles] : [user.role];
        if (roles.includes("COMMITTEE_MEMBER") || user.role === "COMMITTEE_MEMBER") {
          return res.status(400).json({
            message: "Resident is currently a Committee Member. Cannot activate accountant role without removing committee membership first.",
          });
        }
        if (!roles.includes("ACCOUNTANT")) roles.push("ACCOUNTANT");
        await user.update({ roles });
      } else {
        await user.update({ status: "ACTIVE" });
      }

      await assignment.update({
        status: "ACTIVE",
        inactive_date: null,
      });

      return res.json({
        message: "Accountant activated successfully",
        status: "ACTIVE",
        inactive_date: null,
      });
    }
  } catch (err) {
    console.error("toggleAccountantStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — DELETE / DISABLE FALLBACK
   ===== */
const deleteAccountant = async (req, res) => {
  return toggleAccountantStatus(req, res);
};

/* =====
   GET MY PROFILE
   ===== */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "role", "roles", "phone", "resident_type", "society_id", "profile_picture"],
      include: { model: Society, attributes: ["id", "name", "logo_url"] },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const activeRole = (req.user.activeRole || user.role || "RESIDENT").toUpperCase();
    const activeSocietyId = req.user.society_id ? parseInt(req.user.society_id, 10) : user.society_id;
    const dynamicPermissions = await fetchEffectivePermissions(activeSocietyId, activeRole);

    const userObj = user.toJSON();
    if (activeSocietyId && activeSocietyId !== user.society_id) {
      const activeSociety = await Society.findByPk(activeSocietyId, { attributes: ["id", "name", "logo_url"] });
      if (activeSociety) {
        userObj.society_id = activeSocietyId;
        userObj.Society = activeSociety;
      }
    }
    userObj.activeRole = activeRole;
    userObj.society_name = userObj.Society?.name || null;
    userObj.society_logo = userObj.Society?.logo_url || null;
    userObj.society_logo_url = userObj.Society?.logo_url || null;
    userObj.dynamic_permissions = dynamicPermissions;
    userObj.permissions = dynamicPermissions;

    res.json(userObj);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   UPDATE MY PROFILE
   ===== */
const updateMyProfile = async (req, res) => {
  try {
    const { name, phone, password, currentPassword } = req.body;
    const user = await User.findByPk(req.user.id);
    const updateData = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone || null;
    if (password) {
      if (!currentPassword) return res.status(400).json({ message: "Current password is required" });
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });
      updateData.password = await bcrypt.hash(password, 8);
    }
    await user.update(updateData);
    res.json({
      message: "Profile updated",
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, roles: user.roles || [user.role], phone: user.phone,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

/* =====
   PROFILE PICTURE
   ===== */
const uploadMyProfilePicture = async (req, res) => {
  let uploaded = null;
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const incoming = readUploadedProfilePicture(req.file);
    if (!incoming) {
      return res.status(400).json({ message: "No image file was uploaded. Send one file in the 'photo' field." });
    }

    if (!isProfilePictureOwnedBy(incoming.publicId, user.id)) {
      await destroyProfilePicture(incoming.publicId);
      return res.status(400).json({ message: "Invalid image reference." });
    }

    uploaded = incoming;
    const previousPublicId = user.profile_picture_public_id;

    user.profile_picture = incoming.url;
    user.profile_picture_public_id = incoming.publicId;
    await user.save();

    if (previousPublicId && previousPublicId !== incoming.publicId) {
      if (isProfilePictureOwnedBy(previousPublicId, user.id)) {
        await destroyProfilePicture(previousPublicId);
      } else {
        console.error(`[ProfilePicture] Skipped delete of ${previousPublicId}: not owned by user ${user.id}`);
      }
    }

    res.json({
      message: "Profile picture updated",
      profile_picture: user.profile_picture,
    });
  } catch (err) {
    if (uploaded) await destroyProfilePicture(uploaded.publicId);
    console.error(err);
    res.status(500).json({ message: "Failed to update profile picture" });
  }
};

const removeMyProfilePicture = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const previousPublicId = user.profile_picture_public_id;

    user.profile_picture = null;
    user.profile_picture_public_id = null;
    await user.save();

    if (previousPublicId && isProfilePictureOwnedBy(previousPublicId, user.id)) {
      await destroyProfilePicture(previousPublicId);
    }

    res.json({ message: "Profile picture removed", profile_picture: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove profile picture" });
  }
};

/* =====
   PASSWORD RESET
   ===== */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(404).json({ message: "User not found" });
    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password/${resetToken}`;
    sendEmail({
      to: email,
      subject: "Password Reset",
      html: `<a href="${resetLink}">Reset Password</a><p>Expires in 15 minutes.</p>`,
    }).catch((err) => console.error("[Mailer] Forgot password email failed:", err.message));
    res.json({ message: "Reset link sent" });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    user.password = await bcrypt.hash(newPassword, 8);
    await user.save();
    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(400).json({ message: "Invalid or expired token" });
  }
};

/* =====
   FCM TOKEN
   ===== */
const updateFCMToken = async (req, res) => {
  try {
    const { fcm_token } = req.body;
    if (fcm_token) {
      // ✅ Disassociate token from any other accounts on this physical device
      // to prevent duplicate notifications being delivered to the device
      await User.update(
        { fcm_token: null },
        { where: { fcm_token, id: { [Op.ne]: req.user.id } } }
      );
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await user.update({ fcm_token: fcm_token || null });
    res.json({ message: "FCM token updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   COMMITTEE
   ===== */
const promoteToCommittee = async (req, res) => {
  try {
    const { userId, societyId } = req.body;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "RESIDENT" && !user.roles?.includes("RESIDENT"))
      return res.status(400).json({ message: "Only residents can be promoted to committee member" });

    // A rejected registration must be re-approved before it can hold a role,
    // not just before it can be given a flat.
    const notRejected = await ensureNotRejected(userId);
    if (!notRejected.ok) return res.status(notRejected.status).json(notRejected.payload);

    let roles = Array.isArray(user.roles) && user.roles.length > 0 ? [...user.roles] : ["RESIDENT"];

    // Rule: Cannot be both accountant and committee member
    if (roles.includes("ACCOUNTANT") || user.role === "ACCOUNTANT") {
      return res.status(400).json({
        message: "Resident is currently an Accountant. A resident can only be an Accountant or Committee Member, not both simultaneously.",
      });
    }

    const activeAccAssignment = await AccountantAssignment.findOne({
      where: { user_id: userId, status: "ACTIVE" },
    });
    if (activeAccAssignment) {
      return res.status(400).json({
        message: "Resident has an active Accountant assignment. Please deactivate accountant role first before adding to committee.",
      });
    }

    const targetSocietyId = societyId
      ? parseInt(societyId, 10)
      : (req.user?.society_id || user.society_id);

    if (targetSocietyId) {
      let userSociety = await UserSociety.findOne({
        where: { user_id: userId, society_id: targetSocietyId },
      });
      if (!userSociety && user.society_id === targetSocietyId) {
        userSociety = await UserSociety.create({
          user_id: userId,
          society_id: targetSocietyId,
          membership_status: "ACTIVE",
          is_default: true,
          resident_type: user.resident_type || "OWNER",
        });
      }

      if (userSociety) {
        await UserSocietyRole.findOrCreate({
          where: { user_society_id: userSociety.id, role: "COMMITTEE_MEMBER" },
          defaults: { user_society_id: userSociety.id, role: "COMMITTEE_MEMBER" },
        });
        await UserSocietyRole.findOrCreate({
          where: { user_society_id: userSociety.id, role: "RESIDENT" },
          defaults: { user_society_id: userSociety.id, role: "RESIDENT" },
        });
      }
    }

    if (!roles.includes("COMMITTEE_MEMBER")) roles.push("COMMITTEE_MEMBER");

    await user.update({ roles, role: "COMMITTEE_MEMBER" });
    const targetSociety = targetSocietyId ? await Society.findByPk(targetSocietyId) : null;
    res.json({
      message: targetSociety
        ? `Promoted to Committee Member in ${targetSociety.name}`
        : "Promoted to Committee Member",
      roles,
      societyId: targetSocietyId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

const removeCommittee = async (req, res) => {
  try {
    const { userId, societyId } = req.body;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const targetSocietyId = societyId
      ? parseInt(societyId, 10)
      : (req.user?.society_id || null);

    if (targetSocietyId) {
      const userSociety = await UserSociety.findOne({
        where: { user_id: userId, society_id: targetSocietyId },
      });
      if (userSociety) {
        await UserSocietyRole.destroy({
          where: { user_society_id: userSociety.id, role: "COMMITTEE_MEMBER" },
        });
      }
    }

    // Check if user still holds COMMITTEE_MEMBER role in any other society
    const otherCommitteeRoles = await UserSocietyRole.findAll({
      include: [{
        model: UserSociety,
        as: "userSociety",
        where: { user_id: userId },
        required: true,
      }],
      where: { role: "COMMITTEE_MEMBER" },
    });

    let roles = Array.isArray(user.roles) ? [...user.roles] : [];
    if (otherCommitteeRoles.length === 0) {
      roles = roles.filter((r) => r !== "COMMITTEE_MEMBER");
      if (!roles.includes("RESIDENT")) roles.push("RESIDENT");
      await User.update(
        { roles, role: user.role === "COMMITTEE_MEMBER" ? "RESIDENT" : user.role },
        { where: { id: userId } }
      );
    }

    const updatedUser = await User.findByPk(userId);
    const targetSociety = targetSocietyId ? await Society.findByPk(targetSocietyId) : null;
    res.json({
      message: targetSociety
        ? `Removed from Committee in ${targetSociety.name}`
        : "Removed from Committee successfully",
      roles: updatedUser.roles,
      societyId: targetSocietyId,
    });
  } catch (err) {
    console.error("REMOVE COMMITTEE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   TENANT MANAGEMENT (OWNER ACTIONS)
   ===== */

const addTenantByOwner = async (req, res) => {
  try {
    const {
      flat_id, name, email, phone, password,
      vehicle_count, occupant_count,
      move_in_date, move_out_date,
    } = req.body;

    const ownerMembership = await FlatMembership.findOne({
      where: { flat_id, user_id: req.user.id, role: "OWNER", is_current: true },
    });
    if (!ownerMembership) return res.status(403).json({ message: "Access denied." });

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !name || !phone || !password || !move_in_date || !move_out_date) {
      return res.status(400).json({ message: "Name, email, phone, password, and lease dates are required." });
    }

    // If the tenant was created but the follow-up document upload failed,
    // retrying the form should reuse that tenant instead of hitting the
    // users.email unique constraint and returning an opaque 500.
    const existingUser = await User.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      const existingTenantMembership = await FlatMembership.findOne({
        where: { flat_id, user_id: existingUser.id, role: "TENANT", is_current: true },
      });
      if (existingTenantMembership) {
        return res.status(200).json({
          message: "Tenant already exists for this flat. Continue with document upload.",
          tenant: existingUser,
        });
      }
      return res.status(409).json({ message: "A user with this email already exists." });
    }

    const tenant = await User.create({
      name: String(name).trim(), email: normalizedEmail, phone: String(phone).trim(),
      password: await bcrypt.hash(password, 8),
      role: "RESIDENT",
      roles: ["RESIDENT"],
      society_id: req.user.society_id,
      approval_status: "PENDING",
      status: "ACTIVE",
      resident_type: "TENANT",
      vehicle_count: vehicle_count || 0,
      occupant_count: occupant_count || 1,
    });

    await FlatMembership.create({
      flat_id,
      user_id: tenant.id,
      role: "TENANT",
      is_staying: true,
      pays_maintenance: false,
      move_in_date: move_in_date || new Date(),
      move_out_date: move_out_date || null,
      is_current: true,
    });

    await ResidentHistory.create({
      flat_id,
      user_id: tenant.id,
      move_in_date: move_in_date || new Date(),
      is_current: true,
    });

    await ownerMembership.update({ is_staying: false });
    await Flat.update(
      { resident_id: tenant.id, occupancy_status: "RENTED" },
      { where: { id: flat_id } }
    );

    const admins = await User.findAll({
      where: {
        society_id: req.user.society_id,
        approval_status: "APPROVED",
        status: "ACTIVE",
      },
      attributes: ["id"],
    });

    await Promise.all(
      admins.map((admin) =>
        notificationService.sendNotification({
          societyId: req.user.society_id,
          receiverUserId: admin.id,
          senderUserId: admin.id,
          receiverRole: "SOCIETY_ADMIN",
          title: "New Tenant Approval Required",
          message: `Owner ${req.user.name} added tenant ${name} for Flat ${flat_id}. Please verify documents.`,
          type: "SYSTEM",
          sourceEventId: `TENANT_ADD_REQUEST:${flat_id}:${admin.id}`,
        })
      )
    );

    res.status(201).json({ message: "Tenant added. Awaiting Admin approval.", tenant });
  } catch (err) {
    console.error("Add Tenant Error:", err);
    res.status(500).json({ message: err.message });
  }
};

const removeTenantByOwner = async (req, res) => {
  try {
    const { flat_id, tenant_membership_id } = req.body;

    const ownerMembership = await FlatMembership.findOne({
      where: { flat_id, user_id: req.user.id, role: "OWNER", is_current: true },
    });
    if (!ownerMembership) return res.status(403).json({ message: "Access denied." });

    const tenantMembership = await FlatMembership.findOne({
      where: { id: tenant_membership_id, flat_id, role: "TENANT", is_current: true },
    });
    if (!tenantMembership) return res.status(404).json({ message: "Active tenant not found." });

    const tenantUserId = tenantMembership.user_id;

    await tenantMembership.update({ is_current: false, is_staying: false, move_out_date: new Date() });
    await ResidentHistory.update(
      { move_out_date: new Date(), is_current: false },
      { where: { flat_id, user_id: tenantUserId, is_current: true } }
    );

    await User.update(
      { status: "INACTIVE", fcm_token: null },
      { where: { id: tenantUserId } }
    );
    await ParkingSlot.update(
      { resident_id: null, flat_id: null, status: "AVAILABLE" },
      { where: { resident_id: tenantUserId } }
    );

    await ownerMembership.update({ is_staying: true });
    await Flat.update(
      { resident_id: req.user.id, occupancy_status: "OWNER_OCCUPIED" },
      { where: { id: flat_id } }
    );

    const admins = await User.findAll({
      where: {
        society_id: req.user.society_id,
        approval_status: "APPROVED",
        status: "ACTIVE",
      },
      attributes: ["id"],
    });

    await Promise.all(
      admins.map((admin) =>
        notificationService.sendNotification({
          societyId: req.user.society_id,
          receiverUserId: admin.id,
          senderUserId: req.user.id,
          receiverRole: "SOCIETY_ADMIN",
          title: "Tenant Lease Ended",
          message: `The owner has ended the lease for Flat ID ${flat_id}. The tenant's access has been revoked.`,
          type: "SYSTEM",
          sourceEventId: `TENANT_LEASE_ENDED:${flat_id}:${admin.id}`,
        })
      )
    );

    if (tenantUserId) {
      await notificationService.sendNotification({
        societyId: req.user.society_id,
        receiverUserId: tenantUserId,
        senderUserId: req.user.id,
        receiverRole: "RESIDENT",
        title: "Lease Ended",
        message: `Your lease for Flat ID ${flat_id} has been ended by the owner.`,
        type: "SYSTEM",
        sourceEventId: `TENANT_LEASE_ENDED:${flat_id}:${tenantUserId}`,
      });
    }

    res.json({ message: "Tenant removed successfully. Flat reverted to you." });
  } catch (err) {
    console.error("Remove Tenant Error:", err);
    res.status(500).json({ message: err.message });
  }
};

const renewTenantLease = async (req, res) => {
  try {
    const { flat_id, tenant_membership_id, new_move_out_date } = req.body;
 
    if (!new_move_out_date) {
      return res.status(400).json({ message: "New lease end date is required." });
    }
 
    const ownerMembership = await FlatMembership.findOne({
      where: { flat_id, user_id: req.user.id, role: "OWNER", is_current: true },
    });
    if (!ownerMembership) return res.status(403).json({ message: "Access denied." });
 
    const tenantMembership = await FlatMembership.findOne({
      where: { id: tenant_membership_id, flat_id, role: "TENANT", is_current: true },
    });
    if (!tenantMembership) return res.status(404).json({ message: "Active tenant not found." });
 
    await tenantMembership.update({ move_out_date: new_move_out_date });
 
    const message = `Your lease for Flat ${flat_id} has been extended to ${new_move_out_date}.`;
 
    /* ── DB Notification via notificationService ── */
    const normalized = await notificationService.sendNotification({
      societyId: req.user.society_id,
      receiverUserId: tenantMembership.user_id,
      title: "Lease Renewed",
      message,
      type: "LEASE",
      actionType: "LEASE_RENEWAL",
      actionRoute: "/resident/profile",
      sourceEventId: `LEASE_RENEWED:${tenant_membership_id}:${new_move_out_date}`,
      extraData: {
        new_move_out_date,
      },
    });

    /* ── Real-time domain socket event ── */
    if (global.io) {
      global.io
        .to(`user_${tenantMembership.user_id}`)
        .emit("lease_renewed", {
          type: "LEASE_RENEWAL",
          message,
          new_move_out_date,
          notification: normalized,
        });
    }
 
    res.json({ message: "Tenant lease renewed successfully.", move_out_date: new_move_out_date });
  } catch (err) {
    console.error("Renew Tenant Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   PENDING RESIDENTS / APPROVAL
   ===== */
const getPendingResidents = async (req, res) => {
  try {
    const UserDocuments = require("../models/UserDocuments");
    const FlatMembership = require("../models/FlatMembership");
    const Flat = require("../models/Flat");
    const Floor = require("../models/Floor");
    const Block = require("../models/Block");
    const UserSociety = require("../models/UserSociety");
    const { Op } = require("sequelize");

    const targetSocId = (req.user.activeRole === "SUPER_ADMIN" || req.user.role === "SUPER_ADMIN")
      ? (req.query.society_id ? Number(req.query.society_id) : null)
      : Number(req.user.society_id);

    // Also include residents who have a PENDING UserSociety record for this society
    const pendingUserSocieties = targetSocId
      ? await UserSociety.findAll({
          where: { society_id: targetSocId, membership_status: "PENDING" },
          attributes: ["user_id"],
        })
      : await UserSociety.findAll({
          where: { membership_status: "PENDING" },
          attributes: ["user_id"],
        });
    const pendingSocUserIds = pendingUserSocieties.map((us) => us.user_id);

    const whereConditions = [
      {
        role: { [Op.notIn]: ["GUARD", "SUPER_ADMIN", "SOCIETY_ADMIN"] },
      },
    ];
    if (targetSocId) {
      whereConditions.push({
        [Op.or]: [
          {
            society_id: targetSocId,
            [Op.or]: [
              { approval_status: "PENDING" },
              { approval_status: "pending" },
              { approval_status: null, status: "INACTIVE" },
            ],
          },
          ...(pendingSocUserIds.length > 0 ? [{ id: { [Op.in]: pendingSocUserIds } }] : []),
        ],
      });
    } else {
      whereConditions.push({
        [Op.or]: [
          { approval_status: "PENDING" },
          { approval_status: "pending" },
          { approval_status: null, status: "INACTIVE" },
          ...(pendingSocUserIds.length > 0 ? [{ id: { [Op.in]: pendingSocUserIds } }] : []),
        ],
      });
    }

    const users = await User.findAll({
      where: { [Op.and]: whereConditions },
      include: [
        { model: UserDocuments, required: false },
        {
          model: Flat,
          required: false,
          include: [
            {
              model: Floor,
              required: false,
              include: [{ model: Block, required: false }],
            },
            { model: Block, required: false },
          ],
        },
        {
          model: FlatMembership,
          required: false,
          include: [
            {
              model: Flat,
              required: false,
              include: [
                {
                  model: Floor,
                  required: false,
                  include: [{ model: Block, required: false }],
                },
                { model: Block, required: false },
              ],
            },
          ],
        },
      ],
      order: [["id", "DESC"]],
    });

    // Filter out any user who is a SOCIETY_ADMIN or SUPER_ADMIN
    const filteredUsers = users.filter((u) => {
      const roles = Array.isArray(u.roles) ? u.roles : [];
      return (
        u.role !== "SOCIETY_ADMIN" &&
        u.role !== "SUPER_ADMIN" &&
        !roles.includes("SOCIETY_ADMIN") &&
        !roles.includes("SUPER_ADMIN")
      );
    });
    res.json(filteredUsers);
  } catch (err) {
    console.error("Error in getPendingResidents:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   EXPORTS
   ===== */
module.exports = {
  createSocietyAdmin,
  createResident,
  checkResidentEmail,
  createGuard,
  getResidents,
  getPendingResidents,
  updateResident,
  deleteResident,
  toggleResidentStatus,
  getUnassignedResidents,
  getGuards,
  updateGuard,
  getMyFlat,
  deleteGuard,
  createAccountant,
  appointResidentAccountant,
  getEligibleAccountantResidents,
  updateAccountant,
  toggleAccountantStatus,
  deleteAccountant,
  getAccountant,
  getMyProfile,
  updateMyProfile,
  uploadMyProfilePicture,
  removeMyProfilePicture,
  forgotPassword,
  resetPassword,
  updateFCMToken,
  promoteToCommittee,
  removeCommittee,
  addTenantByOwner,
  removeTenantByOwner,
  renewTenantLease,
};
