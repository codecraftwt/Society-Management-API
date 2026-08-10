

const { User, Flat, Block, HouseHoldMember, Society } = require("../models");
const Complaint = require("../models/Complaint");
const ComplaintComment = require("../models/ComplaintComment");
const ComplaintReadStatus = require("../models/ComplaintReadStatus");
const Notification = require("../models/Notification");
const UserSetting = require("../models/UserSetting");
const cloudinary = require("../config/cloudinary");
const Floor = require("../models/Floor");
const { sendPushNotification } = require("../utils/pushNotification");
const { Op } = require("sequelize");
const FlatMembership = require("../models/FlatMembership");


/* =====
   HELPER
===== */
const getPrimaryResidentId = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.resident_id;

  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) {
    const f = await Flat.findByPk(member.flat_id);
    if (f && f.resident_id) return f.resident_id;
  }

  return userId;
};


/* =====
   ✅ ADMIN GET ALL COMPLAINTS (WITH UNREAD COUNT)
===== */
/* =====
   ✅ ADMIN GET ALL COMPLAINTS (WITH UNREAD COUNT + PAGINATION)
===== */
const getComplaints = async (req, res) => {
  try {
    const adminId = req.user.id;

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(1000, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const { block_id, floor_id, flat_id, search, filter } = req.query;
    
    // ✅ Logic: Super Admin with no society_id header gets EVERYTHING
    const where = {};
    const isGlobalSuperAdmin = req.user.activeRole === "SUPER_ADMIN" && !req.headers["x-society-id"];

    if (!isGlobalSuperAdmin) {
      where.society_id = req.user.society_id;
    }

    if (filter && filter !== "ALL") {
      if (filter === "PENDING") {
        where.status = { [Op.in]: ["OPEN", "PENDING"] };
      } else {
        where.status = filter;
      }
    }

    if (search) {
      const q = `%${search}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { description: { [Op.like]: q } },
      ];
    }

    if (flat_id) {
      where.flat_id = flat_id;
    } else if (floor_id || block_id) {
      const flatWhere = {};
      if (block_id) flatWhere.block_id = block_id;
      if (floor_id) flatWhere.floor_id = floor_id;
      const matchingFlats = await Flat.findAll({ where: flatWhere, attributes: ["id"] });
      const flatIds = matchingFlats.map(f => f.id);
      where.flat_id = { [Op.in]: flatIds.length ? flatIds : [-1] };
    }

    const { count, rows } = await Complaint.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
      include: [
        {
          model: User,
          attributes: ["id", "name"],
        },
        {
          model: Flat,
          attributes: ["id", "flat_number"],
          include: [
            { model: Block, attributes: ["id", "name"] },
            { model: Floor, attributes: ["id", "floor_number"] }
          ],
        },
        {
          model: Society,
          attributes: ["id", "name"],
        },
      ],
    });

    // ✅ Get counts for status tabs (ALL, PENDING, IN_PROGRESS, RESOLVED)
    // We reuse the same 'where' filter except for status
    const [totalAll, totalPending, totalInProgress, totalResolved] = await Promise.all([
      Complaint.count({ where }),
      Complaint.count({ where: { ...where, status: { [Op.in]: ["OPEN", "PENDING"] } } }),
      Complaint.count({ where: { ...where, status: "IN_PROGRESS" } }),
      Complaint.count({ where: { ...where, status: "RESOLVED" } }),
    ]);

    const complaintIds = rows.map(c => c.id);

    if (complaintIds.length === 0) {
      return res.status(200).json({
        data: [],
        counts: {
          ALL: totalAll,
          PENDING: totalPending,
          IN_PROGRESS: totalInProgress,
          RESOLVED: totalResolved,
        },
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalItems: count,
          limit,
        },
      });
    }

    // ✅ Get read status for this admin
    const readStatuses = await ComplaintReadStatus.findAll({
      where: {
        complaint_id: { [Op.in]: complaintIds },
        user_id: adminId,
      },
    });

    const readMap = {};
    readStatuses.forEach(r => {
      readMap[r.complaint_id] = r.last_read_at;
    });

    // ✅ Get all comments except admin's own
    const comments = await ComplaintComment.findAll({
      where: {
        complaint_id: { [Op.in]: complaintIds },
        user_id: { [Op.ne]: adminId },
      },
      attributes: ["complaint_id", "created_at"],
      raw: true,
    });

    const unreadMap = {};
    comments.forEach(comment => {
      const lastRead = readMap[comment.complaint_id];

      if (!lastRead || new Date(comment.created_at) > new Date(lastRead)) {
        unreadMap[comment.complaint_id] =
          (unreadMap[comment.complaint_id] || 0) + 1;
      }
    });

    const finalData = rows.map(c => ({
      ...c.toJSON(),
      unread_count: unreadMap[c.id] || 0,
    }));

    res.status(200).json({
      data: finalData,
      counts: {
        ALL: totalAll,
        PENDING: totalPending,
        IN_PROGRESS: totalInProgress,
        RESOLVED: totalResolved,
      },
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        limit,
      },
    });

  } catch (err) {
    console.error("Admin getComplaints Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =====
   ADMIN UPDATE STATUS
===== */
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const complaint = await Complaint.findByPk(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    complaint.status = status;
    await complaint.save();

    const flat = await Flat.findOne({ where: { resident_id: complaint.resident_id } });

    if (flat) {
      const members = await HouseHoldMember.findAll({
        where: { flat_id: flat.id },
        attributes: ["user_id"],
      });

      const allUserIds = new Set();
      if (flat.resident_id) allUserIds.add(flat.resident_id);
      for (const member of members) {
        if (member.user_id) allUserIds.add(member.user_id);
      }

      const usersToNotify = await User.findAll({
        where: { id: { [Op.in]: Array.from(allUserIds) } },
        attributes: ["id", "fcm_token"],
      });

      for (const user of usersToNotify) {
        const settings = await UserSetting.findOne({ where: { user_id: user.id } });
        const shouldNotify = !settings || settings.complaint_updates !== false;

        if (shouldNotify) {
          const notification = await Notification.create({
            title: "Complaint Status Updated",
            message: `Your complaint "${complaint.title}" is now ${status}`,
            type: "COMPLAINT",
            action_type: "VIEW_COMPLAINT",
            action_route: "/resident/complaints",
            society_id: complaint.society_id,
            user_id: req.user.id,
            receiver_role: "RESIDENT",
            receiver_user_id: user.id,
          });

          if (global.io) {
            global.io.to(`user_${user.id}`).emit("new_notification", notification);
          }

          if (user.fcm_token) {
            sendPushNotification(
              user.fcm_token,
              "Complaint Status Updated",
              `Your complaint "${complaint.title}" is now ${status}`,
              { route: "/resident/complaints", complaintId: complaint.id.toString() }
            ).catch((err) => console.error("Push Error:", err));
          }
        }
      }
    }

    res.status(200).json({ message: "Complaint Status updated successfully." });
  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* =====
   RESIDENT CREATE COMPLAINT
   ✅ FIX: emits "new_complaint" to the society room so
   the admin list auto-refreshes in real time without reload.
===== */
/* =====
   ✅ RESIDENT CREATE COMPLAINT
   - Creates complaint
   - Creates notification for all admins
   - Emits real-time bell update
===== */
// const createComplaint = async (req, res) => {
//   try {
//     const { title, description } = req.body;
//     const name = req.user.name || "A resident";
//     const primaryId = await getPrimaryResidentId(req.user.id);

//     const complaint = await Complaint.create({
//       title,
//       description,
//       resident_id: primaryId,
//       society_id: req.user.society_id,
//       flat_id,
//       status: "OPEN",
//       photo_url: req.file ? req.file.path : null,
//       photo_public_id: req.file ? req.file.filename : null,
//     });

//     /* ✅ Fetch full complaint for real-time emit */
//     const fullComplaint = await Complaint.findByPk(complaint.id, {
//      include: [
//   {
//     model: User,
//     attributes: ["id", "name"],
//     include: [
//       {
//         model: Flat,
//         attributes: ["id", "flat_number"],
//         include: [
//           {
//             model: Floor,
//             attributes: ["id", "floor_number"],
//             include: [
//               {
//                 model: Block,
//                 attributes: ["id", "name"],
//               },
//             ],
//           },
//         ],
//       },
//     ],
//   },
// ],
//     });

//     /* ✅ Notify all admins */
//     const admins = await User.findAll({
//       where: {
//         society_id: complaint.society_id,
//         role: { [Op.in]: ["SOCIETY_ADMIN", "COMMITTEE_MEMBER"] },
//       },
//       attributes: ["id"],
//     });

//     for (const admin of admins) {
//       const notification = await Notification.create({
//         title: "New Complaint Raised",
//         message: `${name} raised a complaint: "${title}"`,
//         type: "COMPLAINT",
//         action_type: "VIEW_COMPLAINT",
//         action_route: "/admin/complaints",
//         society_id: complaint.society_id,
//         user_id: req.user.id,
//         receiver_role: "SOCIETY_ADMIN",
//         receiver_user_id: admin.id,
//       });

//       if (global.io) {
//         global.io.to(`user_${admin.id}`).emit("new_notification", notification);
//       }
//     }

//     /* ✅ Emit real-time complaint update */
//     if (global.io) {
//       global.io
//         .to(`society_${complaint.society_id}`)
//         .emit("new_complaint", fullComplaint);
//     }

//     res.status(200).json(complaint);
//   } catch (err) {
//     console.error("createComplaint error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };


 const createComplaint = async (req, res) => {
  try {
    const { title, description, flat_id } = req.body;
    const user = req.user; // Attached by your auth middleware

    let targetFlatId = flat_id;

    // If the user is a TENANT, auto-fetch their assigned flat
    if (user.resident_type === "TENANT" || !targetFlatId) {
      const membership = await FlatMembership.findOne({
        where: { user_id: user.id, is_current: true }
      });
      
      if (!membership) {
        return res.status(400).json({ message: "No active flat assigned to this user." });
      }
      targetFlatId = membership.flat_id;
    } else if (user.resident_type === "OWNER") {
      // ✅ Security: Ensure owners can't raise complaints for rented flats
      const flat = await Flat.findByPk(targetFlatId);
      if (flat && flat.occupancy_status === "RENTED") {
        return res.status(400).json({ message: "Owners cannot raise complaints for units that are currently rented to a tenant." });
      }
    }

    // Create the complaint
    const complaint = await Complaint.create({
      resident_id: user.id,
      society_id: user.society_id,
      flat_id: targetFlatId, // Auto-assigned for tenants, manually selected for owners
      title,
      description,
      status: 'OPEN'
    });

    res.status(201).json({ message: "Complaint submitted successfully", complaint });
  } catch (error) {
    console.error("Complaint Creation Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/* =====
   ✅ RESIDENT GET MY COMPLAINTS (WITH UNREAD COUNT)
===== */
const getMyComplaints = async (req, res) => {
  try {
    const primaryId = await getPrimaryResidentId(req.user.id);
    const userId = req.user.id;

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const search   = req.query.search?.trim() || "";
    const filter   = req.query.filter || "ALL";
    const dateFrom = req.query.dateFrom || "";
    const dateTo   = req.query.dateTo   || "";

    // ── Build WHERE ──
    const where = { resident_id: primaryId };

    if (filter === "PENDING") {
      where.status = { [Op.in]: ["OPEN", "PENDING"] };
    } else if (filter === "IN_PROGRESS") {
      where.status = "IN_PROGRESS";
    } else if (filter === "RESOLVED") {
      where.status = "RESOLVED";
    }

    if (search) {
      where[Op.or] = [
        { title:       { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        where.created_at[Op.gte] = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = to;
      }
    }

    const { count, rows } = await Complaint.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const complaintIds = rows.map(c => c.id);

    // ── Tab counts (always resident-scoped, ignoring search/date) ──
    const [totalAll, totalPending, totalInProgress, totalResolved] = await Promise.all([
      Complaint.count({ where: { resident_id: primaryId } }),
      Complaint.count({ where: { resident_id: primaryId, status: { [Op.in]: ["OPEN", "PENDING"] } } }),
      Complaint.count({ where: { resident_id: primaryId, status: "IN_PROGRESS" } }),
      Complaint.count({ where: { resident_id: primaryId, status: "RESOLVED" } }),
    ]);

    if (complaintIds.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: { currentPage: page, totalPages: 0, totalItems: 0, limit },
        counts: {
          ALL:         totalAll,
          PENDING:     totalPending,
          IN_PROGRESS: totalInProgress,
          RESOLVED:    totalResolved,
        },
      });
    }

    // ── Unread count logic ──
    const readStatuses = await ComplaintReadStatus.findAll({
      where: {
        complaint_id: { [Op.in]: complaintIds },
        user_id: userId,
      },
    });

    const readMap = {};
    readStatuses.forEach(r => {
      readMap[r.complaint_id] = r.last_read_at;
    });

    const comments = await ComplaintComment.findAll({
      where: {
        complaint_id: { [Op.in]: complaintIds },
        user_id: { [Op.ne]: userId },
      },
      attributes: ["complaint_id", "created_at"],
      raw: true,
    });

    const unreadMap = {};
    comments.forEach(comment => {
      const lastRead = readMap[comment.complaint_id];
      if (!lastRead || new Date(comment.created_at) > new Date(lastRead)) {
        unreadMap[comment.complaint_id] = (unreadMap[comment.complaint_id] || 0) + 1;
      }
    });

    const finalData = rows.map(c => ({
      ...c.toJSON(),
      unread_count: unreadMap[c.id] || 0,
    }));

    res.status(200).json({
      data: finalData,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(count / limit),
        totalItems:  count,
        limit,
      },
      counts: {
        ALL:         totalAll,
        PENDING:     totalPending,
        IN_PROGRESS: totalInProgress,
        RESOLVED:    totalResolved,
      },
    });

  } catch (err) {
    console.error("getMyComplaints Error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* =====
   ✅ RESIDENT DELETE COMPLAINT
   FIX: cascade-delete all comments + read statuses first
   so FK constraints don't block the delete.
===== */
const deleteComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findByPk(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Not found" });

    // ✅ Delete dependent rows before deleting the complaint itself.
    //    Without this, FK constraints on ComplaintComment.complaint_id
    //    and ComplaintReadStatus.complaint_id will throw a DB error.
    await ComplaintComment.destroy({ where: { complaint_id: complaint.id } });
    await ComplaintReadStatus.destroy({ where: { complaint_id: complaint.id } });

    // Delete the Cloudinary photo if one was attached
    if (complaint.photo_public_id) {
      await cloudinary.uploader.destroy(complaint.photo_public_id).catch(err =>
        console.error("[deleteComplaint] Cloudinary destroy failed:", err)
      );
    }

    await complaint.destroy();

    // ✅ Notify the admin's society room so their list removes this row in real time
    if (global.io) {
      global.io
        .to(`society_${complaint.society_id}`)
        .emit("complaint_deleted", { complaint_id: complaint.id });
    }

    res.json({ message: "Complaint cancelled successfully" });
  } catch (err) {
    console.error("[deleteComplaint] Error:", err);
    res.status(500).json({ message: err.message });
  }
};


module.exports = {
  getComplaints,
  updateStatus,
  createComplaint,
  getMyComplaints,
  deleteComplaint,
};
