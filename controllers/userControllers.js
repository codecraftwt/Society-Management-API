
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const Society = require("../models/Society");
const Flat = require("../models/Flat");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const HouseHoldMember = require("../models/HouseHoldMember");
const Notification = require("../models/Notification");
const Bill = require("../models/Bill");
const ParkingRequest = require("../models/ParkingRequest");
const ResidentHistory = require("../models/ResidentHistory");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { sendEmail } = require("../services/emailService");
const FlatMembership = require("../models/FlatMembership");
const ParkingSlot = require("../models/ParkingSlot");
const Vehicle = require("../models/Vehicle"); 

/* =====
   MAIL TRANSPORTER
   ===== */
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

async function sendAccountantWelcomeEmail(toEmail, name, password, societyName) {
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
    const { name, email, password } = req.body;
    const society_id = req.params.societyId;

    const existingUser = await User.findOne({ where: { email } });

    if (existingUser) {
      const roles = existingUser.roles || [existingUser.role];
      const updatedRoles = [...new Set([...roles, "SOCIETY_ADMIN", "RESIDENT"])];
      await Promise.all([
        existingUser.update({ name, role: "SOCIETY_ADMIN", roles: updatedRoles }),
        sendEmail({
          to: email,
          subject: "Society Admin Account Updated",
          html: `<h2>Hello ${name}</h2><p>Your Society Admin account has been updated.</p>`,
        }).catch((err) => console.error("[Mailer] Admin update email failed:", err.message)),
      ]);
      return res.status(200).json({ message: "Admin updated and email sent", user: existingUser });
    }

    const hashed = await bcrypt.hash(password, 8);
    const [admin] = await Promise.all([
      User.create({
        name, email, password: hashed,
        role: "SOCIETY_ADMIN", roles: ["SOCIETY_ADMIN", "RESIDENT"],
        society_id,
      }),
      sendEmail({
        to: email,
        subject: "Society Admin Account Created",
        html: `<h2>Welcome ${name}</h2><p><b>Email:</b> ${email}</p><p><b>Password:</b> ${password}</p>`,
      }).catch((err) => console.error("[Mailer] Admin create email failed:", err.message)),
    ]);

    return res.status(201).json({ message: "Admin created successfully", user: admin });
  } catch (err) {
    console.error(err);
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


const createResident = async (req, res) => {
  try {
    const {
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
    } = req.body;

    /* ─────────────────────────────
       Flat is COMPULSORY
    ───────────────────────────── */
    const hasFlatAssignments =
      Array.isArray(flat_assignments) &&
      flat_assignments.some((a) => a.flat_id);

    if (!flat_id && !hasFlatAssignments) {
      return res.status(400).json({
        message:
          "At least one flat assignment is required to create a resident.",
      });
    }

    /* ─────────────────────────────
       Emergency Contact Validation
    ───────────────────────────── */
    if (
      emergency_contact &&
      (!emergency_contact.name || !emergency_contact.phone)
    ) {
      return res.status(400).json({
        message:
          "emergency_contact must include both name and phone.",
      });
    }

    /* ─────────────────────────────
       Password Hash
    ───────────────────────────── */
    const hashed = await bcrypt.hash(password, 8);

    /* ─────────────────────────────
       Create Resident User
    ───────────────────────────── */
    const resident = await User.create({
      name,
      email,
      phone,
      password:        hashed,
      role:            "RESIDENT",
      roles:           ["RESIDENT"],
      society_id:      req.user.society_id,
      approval_status: "APPROVED",
      status:          "ACTIVE",
      resident_type:   resident_type || "OWNER",
      vehicle_count:   0,
      occupant_count:  occupant_count != null ? Number(occupant_count) : 1,
      emergency_contact: emergency_contact || null,
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
          { where: { flat_id: aFlatId, is_current: true } }
        );

        await ResidentHistory.create({
          flat_id:      aFlatId,
          user_id:      resident.id,
          move_in_date: new Date(),
          is_current:   true,
        });

        const isTenant = resident_type === "TENANT";

        await Flat.update(
          {
            resident_id:      resident.id,
            occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
            ...(aFlatType && { flat_type: aFlatType }),
          },
          { where: { id: aFlatId } }
        );

        await FlatMembership.update(
          { is_current: false, move_out_date: new Date() },
          { where: { flat_id: aFlatId, is_current: true } }
        );

        await FlatMembership.create({
          flat_id:          aFlatId,
          user_id:          resident.id,
          role:             resident_type || "OWNER",
          is_staying:       true,
          pays_maintenance: true,
          move_in_date:     new Date(),
          is_current:       true,
        });

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
              { where: { id: slotData.slot_id } }
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
        { where: { flat_id, is_current: true } }
      );

      await ResidentHistory.create({
        flat_id,
        user_id:      resident.id,
        move_in_date: new Date(),
        is_current:   true,
      });

      const isTenant = resident_type === "TENANT";

      await Flat.update(
        {
          resident_id:      resident.id,
          occupancy_status: isTenant ? "RENTED" : "OWNER_OCCUPIED",
          ...(flat_type && { flat_type }),
        },
        { where: { id: flat_id } }
      );

      await FlatMembership.update(
        { is_current: false, move_out_date: new Date() },
        { where: { flat_id, is_current: true } }
      );

      await FlatMembership.create({
        flat_id,
        user_id:          resident.id,
        role:             resident_type || "OWNER",
        is_staying:       true,
        pays_maintenance: true,
        move_in_date:     new Date(),
        is_current:       true,
      });
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
        society_id:      req.user.society_id,
        parking_slot_id: v.parking_slot_id || null,
        parking_type:    typeOfParking,
      });

      if (v.parking_slot_id) {
        await ParkingSlot.update(
          {
            resident_id: resident.id,
            flat_id:     targetFlatId,
            status:      "ASSIGNED",
          },
          { where: { id: v.parking_slot_id } }
        );
      }
    }

    await resident.update({ vehicle_count: vehicleData.length });

    /* ====
       RESPONSE
    ==== */
    res.status(201).json({
      id:       resident.id,
      user:     { id: resident.id },
      resident,
    });

    sendEmail({
      to:      email,
      subject: "Society Resident Account Created",
      html:    `<h2>Welcome ${name}</h2><p>Your Resident account has been created.</p>`,
    }).catch((err) =>
      console.error("[Mailer] Resident create email failed:", err.message)
    );

  } catch (err) {
    console.error("[createResident]", err);
    res.status(500).json({ message: err.message });
  }
};
/* =====
   CREATE GUARD
   ===== */
const createGuard = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 8);
    const guard = await User.create({
      name, email, password: hashed,
      role: "GUARD", roles: ["GUARD"],
      society_id: req.user.society_id,
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
    // SuperAdmin can see all guards if society_id not provided
    const where = req.user.society_id ? { society_id: req.user.society_id } : {};

    const allUsers = await User.findAll({
      where,
      include: { model: Society, attributes: ["id", "name"], required: false },
      attributes: ["id", "name", "email", "role", "roles", "society_id"],
    });

    const guards = allUsers.filter((u) => (u.roles || [u.role]).includes("GUARD"));
    res.status(200).json(
      guards.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        society_id: g.society_id,
        societyName: g.Society?.name || "NA",
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

    // Security check
    if (req.user.role !== "SUPER_ADMIN" && String(guard.society_id) !== String(req.user.society_id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const updateData = { name, email };
    if (password) {
      updateData.password = await bcrypt.hash(password, 8);
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
    const limit    = Math.min(50, parseInt(req.query.limit) || 10);
    const offset   = (page - 1) * limit;
    const search   = req.query.search?.trim() || "";
    
    // Cascading Filter Params
    const { society_id, block_id, floor_id, flat_id } = req.query;

    const searchWhere = {};
    
    // 1. Filter by Society (Super Admin vs Regular Admin)
    if (req.user.activeRole === "SUPER_ADMIN") {
      if (society_id) searchWhere.society_id = society_id;
    } else {
      searchWhere.society_id = req.user.society_id;
    }

    // 2. Filter by Search Query
    if (search) {
      searchWhere[Op.or] = [
        { name:  { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const allUsers = await User.findAll({
      where: searchWhere,
      order: [["name", "ASC"]],
    });

    const residentUsers = allUsers.filter((u) =>
      (u.roles || [u.role]).includes("RESIDENT")
    );

    // Deduplicate users (in case of duplicate entries)
    const emailMap = new Map();
    residentUsers.forEach(user => {
      const key = user.email ? user.email.toLowerCase().trim() : user.id;
      if (!emailMap.has(key)) emailMap.set(key, user.toJSON());
    });

    let uniqueResidents = Array.from(emailMap.values());
    const userIds = uniqueResidents.map(u => u.id);

    // Fetch flats for the matched residents
    const allFlats = await Flat.findAll({
      where: { resident_id: { [Op.in]: userIds } },
      attributes: ["id", "flat_number", "flat_type", "floor_id", "resident_id"],
      include: [
        {
          model: Floor,
          attributes: ["id", "floor_number"],
          required: false,
          include: [{ model: Block, attributes: ["id", "name"], required: false }],
        },
        {
          model: Block,
          attributes: ["id", "name"],
          required: false,
        },
      ],
    });

    // 3. Apply Cascading Filters (Block / Floor / Flat)
    if (block_id || floor_id || flat_id) {
      uniqueResidents = uniqueResidents.filter(user => {
        const userFlats = allFlats.filter(f => String(f.resident_id) === String(user.id));
        return userFlats.some(f => {
          const fBlockId = f.Floor?.Block?.id || f.Block?.id;
          const fFloorId = f.floor_id;
          const fFlatId  = f.id;

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

    const data = paginated.map(user => {
      const userFlats = allFlats
        .filter(f => f.resident_id === user.id)
        .map(f => ({
          id:           f.id,
          flat_id:      f.id,
          flat_number:  f.flat_number,
          flat_type:    f.flat_type,
          floor_id:     f.floor_id,
          Floor: f.Floor ? {
            id:           f.Floor.id,
            floor_number: f.Floor.floor_number,
            Block: f.Floor.Block ? { id: f.Floor.Block.id, name: f.Floor.Block.name } : null,
          } : null,
          Block: f.Block ? { id: f.Block.id, name: f.Block.name } : null,
          floor_number: f.Floor?.floor_number ?? null,
          block_name:   f.Floor?.Block?.name || f.Block?.name || null,
        }));

      return {
        id:                user.id,
        name:              user.name,
        email:             user.email,
        phone:             user.phone || null,
        status:            user.status,
        approval_status:   user.approval_status,
        roles:             user.roles || [user.role],
        resident_type:     user.resident_type || null,
        vehicle_count:     user.vehicle_count  ?? 0,
        occupant_count:    user.occupant_count ?? 1,
        emergency_contact: user.emergency_contact || null,
        society_id:        user.society_id,
        flats:             userFlats,
        flat_id:      userFlats[0]?.id           || null,
        flat_number:  userFlats[0]?.flat_number   || null,
        flat_type:    userFlats[0]?.flat_type     || null,
        floor_number: userFlats[0]?.floor_number  || null,
        block_name:   userFlats[0]?.block_name    || null,
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
    } = req.body;

    const resident = await User.findByPk(id);
    if (!resident) return res.status(404).json({ message: "Resident not found" });
    if (!(resident.roles || [resident.role]).includes("RESIDENT"))
      return res.status(404).json({ message: "Resident not found" });

    if (emergency_contact && (!emergency_contact.name || !emergency_contact.phone)) {
      return res.status(400).json({ message: "emergency_contact must include both name and phone." });
    }

    const userUpdatePayload = { name, phone, resident_type };
    if (vehicle_count  != null) userUpdatePayload.vehicle_count  = Number(vehicle_count);
    if (occupant_count != null) userUpdatePayload.occupant_count = Number(occupant_count);
    if (emergency_contact !== undefined) {
      userUpdatePayload.emergency_contact = emergency_contact || null;
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
        const flatUpdatePayload = {
          resident_id: resident.id,
          occupancy_status: resident_type === "TENANT" ? "RENTED" : "OWNER_OCCUPIED",
        };
        if (flat_type) flatUpdatePayload.flat_type = flat_type;
        await Flat.update(flatUpdatePayload, { where: { id: flat_id } });
      } else if (flat_type) {
        await Flat.update({ flat_type }, { where: { id: flat_id } });
      }
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
      Notification.destroy({ where: { user_id: id } }),
    ]);

    await resident.destroy();
    res.json({ message: "Resident deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET UNASSIGNED RESIDENTS
   ===== */
const getUnassignedResidents = async (req, res) => {
  try {
    const allUsers = await User.findAll({
      where: { society_id: req.user.society_id, status: "ACTIVE" },
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
        attributes: ["id", "flat_number", "occupancy_status"],
        include: [
          { model: Block, attributes: ["id", "name"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name"], required: false }],
          },
        ],
      }],
    });

    for (const m of memberships) {
      if (m.Flat && !addedFlatIds.has(m.flat_id)) {
        const flat = m.Flat;
        const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
        const floorNumber = flat?.Floor?.floor_number ?? null;

        flatsList.push({
          user_id:      user.id,
          user_name:    user.name,
          flat_id:      flat.id,
          flat_number:  flat.flat_number || null,
          block_name:   blockName,
          floor_number: floorNumber,
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
        attributes: ["id", "flat_number", "occupancy_status"],
        include: [
          { model: Block, attributes: ["id", "name"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name"], required: false }],
          },
        ],
      }],
    });

    for (const hm of householdMembers) {
      if (hm.Flat && !addedFlatIds.has(hm.flat_id)) {
        const flat = hm.Flat;
        const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
        const floorNumber = flat?.Floor?.floor_number ?? null;

        flatsList.push({
          user_id:      user.id,
          user_name:    user.name,
          flat_id:      flat.id,
          flat_number:  flat.flat_number || null,
          block_name:   blockName,
          floor_number: floorNumber,
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
          { model: Block, attributes: ["id", "name"], required: false },
          {
            model: Floor,
            attributes: ["id", "floor_number"],
            required: false,
            include: [{ model: Block, attributes: ["id", "name"], required: false }],
          },
        ],
      });

      for (const flat of directFlats) {
        if (!addedFlatIds.has(flat.id)) {
          const blockName   = flat?.Floor?.Block?.name || flat?.Block?.name || null;
          const floorNumber = flat?.Floor?.floor_number ?? null;

          flatsList.push({
            user_id:          user.id,
            user_name:        user.name,
            flat_id:          flat.id,
            flat_number:      flat.flat_number || null,
            block_name:       blockName,
            floor_number:     floorNumber,
            isAdmin:          true,
            role:             "OWNER",
            occupancy_status: flat.occupancy_status,
          });
          addedFlatIds.add(flat.id);
        }
      }
    }

    return res.json(flatsList);

  } catch (error) {
    console.error("[getMyFlat]", error);
    res.status(500).json({ message: error.message });
  }
};

/* =====
   ACCOUNTANT — CREATE
   ===== */
const createAccountant = async (req, res) => {
  try {
    const { name, email, password, phone, society_id } = req.body;

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

    const allUsers = await User.findAll({
      where: { society_id: targetSocietyId },
      attributes: ["id", "role", "roles"],
    });
    const existing = allUsers.find((u) => (u.roles || [u.role]).includes("ACCOUNTANT"));
    if (existing) return res.status(400).json({ message: "Only one Accountant allowed per society" });

    const hashed = await bcrypt.hash(password, 8);
    const accountant = await User.create({
      name, email, phone, password: hashed,
      role: "ACCOUNTANT", roles: ["ACCOUNTANT"],
      society_id: targetSocietyId,
    });

    res.status(201).json(accountant);

    const society = await Society.findByPk(targetSocietyId);
    sendAccountantWelcomeEmail(email, name, password, society?.name || "your society")
      .catch((err) => console.error("[Mailer] Accountant welcome email failed:", err.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — GET
   ===== */
const getAccountant = async (req, res) => {
  try {
    const { society_id } = req.query;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    const where = {};
    if (isSuperAdmin) {
      if (society_id) where.society_id = society_id;
    } else {
      where.society_id = req.user.society_id;
    }

    const allUsers = await User.findAll({
      where,
      attributes: ["id", "name", "email", "phone", "role", "roles", "society_id"],
      include: [{ model: Society, attributes: ["id", "name"], required: false }],
    });

    const filtered = allUsers.filter((u) => (u.roles || [u.role]).includes("ACCOUNTANT"));

    const data = filtered.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      roles: u.roles,
      society_id: u.society_id,
      societyName: u.Society?.name || "NA",
    }));

    if (isSuperAdmin && !society_id) {
      // Return array for Super Admin list view
      res.json(data);
    } else {
      // Return single object for Society Admin or specific filtered society
      res.json(data[0] || null);
    }
  } catch (err) {
    console.error("getAccountant error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — UPDATE
   ===== */
const updateAccountant = async (req, res) => {
  try {
    const { name, phone, society_id } = req.body;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    let targetSocietyId = req.user.society_id;
    if (isSuperAdmin && society_id) {
      targetSocietyId = society_id;
    }

    if (!targetSocietyId) {
      return res.status(400).json({ message: "Society ID is required" });
    }

    if (phone) {
      const phoneRegex = /^[6-9]\d{9}$/;
      if (!phoneRegex.test(phone.replace(/\s/g, "")))
        return res.status(400).json({ message: "Please provide a valid 10-digit Indian mobile number." });
    }

    const allUsers = await User.findAll({ where: { society_id: targetSocietyId } });
    const accountant = allUsers.find((u) => (u.roles || [u.role]).includes("ACCOUNTANT"));
    if (!accountant) return res.status(404).json({ message: "Accountant not found" });

    await accountant.update({ name, ...(phone && { phone }) });
    res.json({ message: "Accountant updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ACCOUNTANT — DELETE
   ===== */
const deleteAccountant = async (req, res) => {
  try {
    const { society_id } = req.query;
    const activeRole = req.user.activeRole || req.user.role;
    const isSuperAdmin = activeRole === "SUPER_ADMIN";

    let targetSocietyId = req.user.society_id;
    if (isSuperAdmin && society_id) targetSocietyId = society_id;

    if (!targetSocietyId) return res.status(400).json({ message: "Society ID is required" });

    const allUsers = await User.findAll({ where: { society_id: targetSocietyId } });
    const accountant = allUsers.find((u) => (u.roles || [u.role]).includes("ACCOUNTANT"));
    if (!accountant) return res.status(404).json({ message: "Accountant not found" });

    await accountant.destroy();
    res.json({ message: "Accountant deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   GET MY PROFILE
   ===== */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "role", "roles", "phone", "resident_type"],
      include: { model: Society, attributes: ["id", "name"] },
    });
    res.json(user);
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
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile" });
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
    const user = await User.findByPk(req.user.id);
    await user.update({ fcm_token });
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
    const { userId } = req.body;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "RESIDENT")
      return res.status(400).json({ message: "Only residents can be promoted to committee member" });

    let roles = Array.isArray(user.roles) && user.roles.length > 0 ? [...user.roles] : ["RESIDENT"];
    if (!roles.includes("COMMITTEE_MEMBER")) roles.push("COMMITTEE_MEMBER");

    await user.update({ roles, role: "COMMITTEE_MEMBER" });
    res.json({ message: "Promoted to Committee Member", roles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

const removeCommittee = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let roles = Array.isArray(user.roles) ? [...user.roles] : [];
    roles = roles.filter((r) => r !== "COMMITTEE_MEMBER");
    if (!roles.includes("RESIDENT")) roles.push("RESIDENT");

    await User.update({ roles, role: "RESIDENT" }, { where: { id: userId } });
    const updatedUser = await User.findByPk(userId);
    res.json({ message: "Removed from Committee successfully", roles: updatedUser.roles });
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

    const tenant = await User.create({
      name, email, phone,
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

    await Notification.create({
      title: "New Tenant Approval Required",
      message: `Owner ${req.user.name} added tenant ${name} for Flat ${flat_id}. Please verify documents.`,
      type: "SYSTEM",
      society_id: req.user.society_id,
      receiver_role: "SOCIETY_ADMIN",
    });

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

    await Notification.create({
      title: "Tenant Lease Ended",
      message: `The owner has ended the lease for Flat ID ${flat_id}. The tenant's access has been revoked.`,
      type: "SYSTEM",
      society_id: req.user.society_id,
      receiver_role: "SOCIETY_ADMIN",
    });

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
 
    /* ── DB Notification ── */
    const notification = await Notification.create({
      title:            "Lease Renewed",
      message,
      type:             "LEASE",
      action_type:      "LEASE_RENEWAL",
      action_route:     "/resident/profile",
      society_id:       req.user.society_id,
      receiver_user_id: tenantMembership.user_id,
    });
 
    /* ── Real-time socket event ── */
    if (global.io) {
      global.io
        .to(`user_${tenantMembership.user_id}`)
        .emit("lease_renewed", {
          type:         "LEASE_RENEWAL",
          message,
          new_move_out_date,
          notification,  // front-end can push it straight into the bell list
        });
    }
 
    /* ── FCM push ── */
    const tenant = await User.findByPk(tenantMembership.user_id, {
      attributes: ["fcm_token"],
    });
    if (tenant?.fcm_token) {
      sendPushNotification(
        tenant.fcm_token,
        "🎉 Lease Renewed",
        message,
        { type: "LEASE_RENEWAL", route: "/resident/profile" }
      ).catch((err) => console.error("[renewTenantLease] Push error:", err.message));
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
    const users = await User.findAll({
      where: {
        society_id: req.user.society_id,
        approval_status: "PENDING",
        resident_type: "TENANT",
      },
      include: [
        { model: require("../models/UserDocuments"), required: false },
        {
          model: require("../models/FlatMembership"),
          where: { is_current: true, role: "TENANT" },
          include: [{ model: require("../models/Flat") }],
          required: false,
        },
      ],
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const approveResident = async (req, res) => {
  try {
    const { userId } = req.params;
    await User.update({ approval_status: "APPROVED" }, { where: { id: userId } });
    res.json({ message: "Resident approved successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =====
   EXPORTS
   ===== */
module.exports = {
  createSocietyAdmin,
  createResident,
  createGuard,
  getResidents,
  getPendingResidents,
  updateResident,
  deleteResident,
  getUnassignedResidents,
  getGuards,
  updateGuard,
  getMyFlat,
  deleteGuard,
  createAccountant,
  updateAccountant,
  deleteAccountant,
  getAccountant,
  getMyProfile,
  updateMyProfile,
  forgotPassword,
  resetPassword,
  updateFCMToken,
  promoteToCommittee,
  removeCommittee,
  addTenantByOwner,
  removeTenantByOwner,
  approveResident,
  renewTenantLease,
};