const Society = require("../models/Society");
const User = require("../models/User");
const { Op } = require("sequelize");
const {
  Block, Flat, VisitorLog, Payment, Complaint, Notice, Bill, Notification,
  Floor, Vehicle, ParkingSlot, Amenity, EmergencyAlert, Document, GuardShift,
} = require("../models");

// CREATE SOCIETY
const createSociety = async (req, res) => {
  try {
    const society = await Society.create(req.body);
    res.status(200).json(society);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET ALL SOCIETIES WITH ADMINS
const getAllSociety = async (req, res) => {
  try {
    // Attributes are pinned to columns that have existed since the feature shipped.
    // If the model ever gains a column the table does not have (schema drift), the
    // unpinned `SELECT *` would blow up with "Unknown column" and take this endpoint
    // down — so the list is built from an explicit, stable column set instead.
    const SOCIETY_LIST_ATTRS = [
      "id",
      "name",
      "address",
      "latitude",
      "longitude",
      "location_radius",
      "primary_color",
      "accent_color",
    ];

    let societies;
    try {
      societies = await Society.findAll({
        attributes: SOCIETY_LIST_ATTRS,
        include: [
          {
            model: User,
            where: { role: "SOCIETY_ADMIN" },
            required: false,
            attributes: ["id", "name", "email"],
          },
        ],
      });
    } catch (queryErr) {
      // Last-resort fallback: the dropdown only needs id/name/address, so serve it
      // without the association rather than returning a 500.
      console.error("getAllSociety: society query failed, falling back to minimal columns:", queryErr.message);
      societies = await Society.findAll({ attributes: ["id", "name", "address"] });
    }

    const formatted = (Array.isArray(societies) ? societies : []).map((s) => {
      const admins = Array.isArray(s.Users) ? s.Users : [];
      return {
        id: s.id,
        name: s.name,
        address: s.address,
        societyAdmins:
          admins.length > 0
            ? {
                id: admins[0].id,
                name: admins[0].name,
                email: admins[0].email,
              }
            : null,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("getAllSociety error:", err.message);
    res.status(500).json({ message: "Unable to load societies right now." });
  }
};

// SOCIETY DETAIL — full profile + live stats for the /superadmin/societies detail view
const getSocietyDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const society = await Society.findByPk(id);
    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    // ── Admins ──
    const admins = await User.findAll({
      where: { society_id: id, role: "SOCIETY_ADMIN" },
      attributes: ["id", "name", "email", "phone", "status", "created_at"],
      order: [["created_at", "ASC"]],
    });

    // ── Structure counts ──
    const blocks = await Block.findAll({
      where: { society_id: id },
      attributes: ["id", "name", "property_type"],
    });
    const blockIds = (blocks || []).map((b) => b.id);
    const propertyTypes = [...new Set((blocks || []).map((b) => b.property_type).filter(Boolean))];

    const flatWhere = blockIds.length ? { block_id: { [Op.in]: blockIds } } : { block_id: { [Op.in]: [-1] } };
    const floorWhere = blockIds.length ? { block_id: { [Op.in]: blockIds } } : { block_id: { [Op.in]: [-1] } };

    const [floorCount, flatCount, flats] = await Promise.all([
      Floor.count({ where: floorWhere }),
      Flat.count({ where: flatWhere }),
      Flat.findAll({
        where: flatWhere,
        attributes: ["id", "occupancy_status"],
      }),
    ]);
    const occupiedFlats = flats.filter((f) => f.occupancy_status !== "VACANT" && f.occupancy_status !== null).length;
    const vacantFlats = flats.length - occupiedFlats;

    // ── People counts ──
    const [residents, guards, committee, accountants, pendingUsers] = await Promise.all([
      User.count({ where: { society_id: id, role: "RESIDENT", approval_status: "APPROVED" } }),
      User.count({ where: { society_id: id, role: "GUARD" } }),
      User.count({ where: { society_id: id, role: "COMMITTEE_MEMBER" } }),
      User.count({ where: { society_id: id, role: "ACCOUNTANT" } }),
      User.count({ where: { society_id: id, role: "RESIDENT", approval_status: "PENDING" } }),
    ]);
    const [owners, tenants] = await Promise.all([
      User.count({ where: { society_id: id, role: "RESIDENT", resident_type: "OWNER", approval_status: "APPROVED" } }),
      User.count({ where: { society_id: id, role: "RESIDENT", resident_type: "TENANT", approval_status: "APPROVED" } }),
    ]);

    // ── Activity counts ──
    const [totalComplaints, openComplaints, inProgressComplaints, resolvedComplaints, noticeCount, visitorCount, emergencyCount, vehicleCount] = await Promise.all([
      Complaint.count({ where: { society_id: id } }),
      Complaint.count({ where: { society_id: id, status: "OPEN" } }),
      Complaint.count({ where: { society_id: id, status: "IN_PROGRESS" } }),
      Complaint.count({ where: { society_id: id, status: "RESOLVED" } }),
      Notice.count({ where: { society_id: id } }),
      VisitorLog.count({ where: { society_id: id } }),
      EmergencyAlert.count({ where: { society_id: id } }),
      Vehicle.count({ where: { society_id: id } }),
    ]);

    const [slotCount, assignedSlots, amenityCount, documentCount, guardCount] = await Promise.all([
      ParkingSlot.count({ where: { society_id: id } }),
      ParkingSlot.count({ where: { society_id: id, resident_id: { [Op.ne]: null } } }),
      Amenity.count({ where: { society_id: id } }),
      Document.count({ where: { society_id: id } }),
      GuardShift.count({ where: { society_id: id } }),
    ]);

    // ── Finance (bills + payments aggregated) ──
    const flatIds = flats.map((f) => f.id);
    const billWhere = flatIds.length ? { flat_id: { [Op.in]: flatIds } } : { flat_id: { [Op.in]: [-1] } };
    const billRows = await Bill.findAll({
      where: billWhere,
      attributes: ["id", "amount", "status"],
    });
    const billCount = billRows.length;
    const billedAmount = billRows.reduce((s, b) => s + Number(b.amount || 0), 0);
    const paidBills = billRows.filter((b) => b.status === "PAID");
    const paidCount = paidBills.length;
    const paidAmount = paidBills.reduce((s, b) => s + Number(b.amount || 0), 0);
    const pendingCount = billCount - paidCount;
    const pendingAmount = Math.max(0, billedAmount - paidAmount);

    const successPayments = await Payment.findAll({
      where: { society_id: id, status: "SUCCESS" },
      attributes: ["id", "amount"],
    });
    const collectedAmount = successPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    res.json({
      success: true,
      data: {
        id: society.id,
        name: society.name,
        address: society.address,
        created_at: society.created_at,
        opening_balance: Number(society.opening_balance) || 0,
        admins: admins.map((a) => a.toJSON()),
        propertyTypes,
        structure: {
          blocks: blocks.length,
          floors: floorCount,
          flats: flatCount,
          occupiedFlats,
          vacantFlats,
        },
        people: {
          residents,
          owners,
          tenants,
          pending: pendingUsers,
          guards,
          committee,
          accountants,
        },
        activity: {
          complaints: totalComplaints,
          openComplaints,
          inProgressComplaints,
          resolvedComplaints,
          notices: noticeCount,
          visitors: visitorCount,
          emergencies: emergencyCount,
          vehicles: vehicleCount,
          parkingSlots: slotCount,
          assignedSlots,
          amenities: amenityCount,
          documents: documentCount,
          guardShifts: guardCount,
        },
        finance: {
          billedAmount,
          paidAmount,
          pendingAmount,
          paidCount,
          pendingCount,
          billCount,
          collectedAmount,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteSociety = async (req, res) => {
    const { id } = req.params;

    try {
        const society = await Society.findByPk(id);
        if (!society) {
            return res.status(400).json({ message: "Society is not found." });
        }

        // Get all users first (needed for notifications)
        const users = await User.findAll({ where: { society_id: id } });
        const userIds = users.map(u => u.id);

        const blocks = await Block.findAll({ where: { society_id: id } });
        const blockIds = blocks.map(b => b.id);

        const flats = await Flat.findAll({ where: { block_id: blockIds } });
        const flatIds = flats.map(f => f.id);

        const bills = await Bill.findAll({ where: { flat_id: flatIds } });
        const billIds = bills.map(b => b.id);

        // Delete in correct order (child → parent)
        await Payment.destroy({ where: { bill_id: billIds } });
        await Bill.destroy({ where: { flat_id: flatIds } });

        await VisitorLog.destroy({ where: { flat_id: flatIds } });

        await Flat.destroy({ where: { block_id: blockIds } });
        await Block.destroy({ where: { society_id: id } });

        await Complaint.destroy({ where: { society_id: id } });
        await Notice.destroy({ where: { society_id: id } });

        // 🔥 FIX HERE
        await Notification.destroy({ where: { user_id: userIds } });

        await User.destroy({ where: { society_id: id } });

        await Society.destroy({ where: { id } });

        res.status(200).json({ message: "Society Deleted Successfully !!" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── SOCIETY THEME CUSTOMIZATION ─────────────────────────────────────────────

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * GET /api/societies/:id/theme
 * Fetches the active custom theme branding for a society or default fallback.
 */
const getSocietyTheme = async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ success: false, message: "Invalid society ID." });
  }

  const isSuperAdmin = req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const isOwnSociety = req.user?.society_id === targetId;

  // Cross-society access guard: only Super Admin or authenticated members of the target society can read its theme
  if (!isSuperAdmin && !isOwnSociety) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to access theme settings for this society.",
    });
  }

  try {
    const society = await Society.findByPk(targetId, {
      attributes: ["id", "name", "primary_color", "accent_color", "card_style", "quick_link_style", "theme_updated_by", "theme_updated_at"],
    });

    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    const configured = Boolean(society.primary_color || society.accent_color || (society.card_style && society.card_style !== "default") || (society.quick_link_style && society.quick_link_style !== "default"));

    return res.status(200).json({
      success: true,
      society_id: society.id,
      society_name: society.name,
      configured,
      theme: {
        primary: society.primary_color || null,
        accent: society.accent_color || null,
        cardStyle: society.card_style || "default",
        card_style: society.card_style || "default",
        quickLinkStyle: society.quick_link_style || "default",
        quick_link_style: society.quick_link_style || "default",
      },
      theme_updated_by: society.theme_updated_by,
      theme_updated_at: society.theme_updated_at,
    });
  } catch (err) {
    console.error("getSocietyTheme error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/societies/:id/theme
 * Updates the custom primary and accent theme colors for a society.
 */
const updateSocietyTheme = async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ success: false, message: "Invalid society ID." });
  }

  const isSuperAdmin = req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const isSocietyAdmin = req.user?.activeRole === "SOCIETY_ADMIN" || req.user?.role === "SOCIETY_ADMIN";
  const isOwnSociety = req.user?.society_id === targetId;

  // Authorization check: Super Admin or own Society Admin only
  if (!isSuperAdmin && (!isSocietyAdmin || !isOwnSociety)) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to modify theme settings for this society.",
    });
  }

  const primary = req.body.primary_color || req.body.primary;
  const accent = req.body.accent_color || req.body.accent;
  const cardStyle = req.body.card_style || req.body.cardStyle;
  const quickLinkStyle = req.body.quick_link_style || req.body.quickLinkStyle;

  if (!primary && !accent && !cardStyle && !quickLinkStyle) {
    return res.status(400).json({
      success: false,
      message: "At least one theme property (primary color, accent color, or card style) is required.",
    });
  }

  if (primary && !HEX_COLOR_REGEX.test(String(primary).trim())) {
    return res.status(400).json({
      success: false,
      message: "Invalid primary color format. Expected a valid HEX code (e.g. #7c3aed).",
    });
  }

  if (accent && !HEX_COLOR_REGEX.test(String(accent).trim())) {
    return res.status(400).json({
      success: false,
      message: "Invalid accent color format. Expected a valid HEX code (e.g. #8b5cf6).",
    });
  }

  try {
    const society = await Society.findByPk(targetId);
    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    society.primary_color = primary ? String(primary).trim() : society.primary_color;
    society.accent_color = accent ? String(accent).trim() : society.accent_color;
    if (cardStyle) {
      society.card_style = String(cardStyle).trim();
    }
    if (quickLinkStyle) {
      society.quick_link_style = String(quickLinkStyle).trim();
    }
    society.theme_updated_by = req.user.id;
    society.theme_updated_at = new Date();
    await society.save();

    // Broadcast real-time theme change to all connected clients in the society room
    if (global.io) {
      global.io.to(`society_${society.id}`).emit("society_theme_updated", {
        society_id: society.id,
        theme: {
          primary: society.primary_color,
          accent: society.accent_color,
          cardStyle: society.card_style || "default",
          card_style: society.card_style || "default",
          quickLinkStyle: society.quick_link_style || "default",
          quick_link_style: society.quick_link_style || "default",
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Society theme updated successfully.",
      society_id: society.id,
      configured: true,
      theme: {
        primary: society.primary_color,
        accent: society.accent_color,
        cardStyle: society.card_style || "default",
        card_style: society.card_style || "default",
        quickLinkStyle: society.quick_link_style || "default",
        quick_link_style: society.quick_link_style || "default",
      },
      theme_updated_at: society.theme_updated_at,
    });
  } catch (err) {
    console.error("updateSocietyTheme error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/societies/:id/theme/reset
 * Reverts the society theme configuration to default.
 */
const resetSocietyTheme = async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ success: false, message: "Invalid society ID." });
  }

  const isSuperAdmin = req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const isSocietyAdmin = req.user?.activeRole === "SOCIETY_ADMIN" || req.user?.role === "SOCIETY_ADMIN";
  const isOwnSociety = req.user?.society_id === targetId;

  if (!isSuperAdmin && (!isSocietyAdmin || !isOwnSociety)) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to reset theme settings for this society.",
    });
  }

  try {
    const society = await Society.findByPk(targetId);
    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    society.primary_color = null;
    society.accent_color = null;
    society.card_style = "default";
    society.quick_link_style = "default";
    society.theme_updated_by = req.user.id;
    society.theme_updated_at = new Date();
    await society.save();

    if (global.io) {
      global.io.to(`society_${society.id}`).emit("society_theme_updated", {
        society_id: society.id,
        theme: {
          primary: null,
          accent: null,
          cardStyle: "default",
          card_style: "default",
          quickLinkStyle: "default",
          quick_link_style: "default",
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Society theme reset to default successfully.",
      society_id: society.id,
      configured: false,
      theme: {
        primary: null,
        accent: null,
        cardStyle: "default",
        card_style: "default",
        quickLinkStyle: "default",
        quick_link_style: "default",
      },
    });
  } catch (err) {
    console.error("resetSocietyTheme error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/societies/geofence
 * Returns the current society's geofence configuration.
 * Accessible by Society Admin and committee members.
 */
const getSocietyGeofence = async (req, res) => {
  const societyId = req.user?.society_id;
  if (!societyId) {
    return res.status(403).json({ success: false, message: "You are not assigned to any society." });
  }
  try {
    const society = await Society.findByPk(societyId, {
      attributes: ["id", "name", "address", "latitude", "longitude", "location_radius"],
    });
    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }
    const configured = society.latitude != null && society.longitude != null;
    return res.status(200).json({
      success: true,
      society_id: society.id,
      society_name: society.name,
      address: society.address,
      configured,
      geofence: {
        latitude: society.latitude != null ? parseFloat(society.latitude) : null,
        longitude: society.longitude != null ? parseFloat(society.longitude) : null,
        radius_meters: society.location_radius != null ? parseFloat(society.location_radius) : 50,
        address: society.address,
      },
    });
  } catch (err) {
    console.error("getSocietyGeofence error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/societies/geofence
 * Updates the geofence for the caller's society.
 * Only Society Admin (or Super Admin) can update.
 */
const updateSocietyGeofence = async (req, res) => {
  const isSuperAdmin = req.user?.activeRole === "SUPER_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const isSocietyAdmin = req.user?.activeRole === "SOCIETY_ADMIN" || req.user?.role === "SOCIETY_ADMIN";

  if (!isSuperAdmin && !isSocietyAdmin) {
    return res.status(403).json({ success: false, message: "Only Society Admins can update geofence settings." });
  }

  // For super admin, allow society_id in body; otherwise use own society
  const targetSocietyId = isSuperAdmin
    ? (req.body.society_id || req.user?.society_id)
    : req.user?.society_id;

  if (!targetSocietyId) {
    return res.status(400).json({ success: false, message: "society_id is required." });
  }

  const { latitude, longitude, radius_meters, address } = req.body;

  if (latitude == null || longitude == null) {
    return res.status(400).json({ success: false, message: "latitude and longitude are required." });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const radius = radius_meters != null ? parseFloat(radius_meters) : 50;

  if (isNaN(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ success: false, message: "latitude must be a number between -90 and 90." });
  }
  if (isNaN(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, message: "longitude must be a number between -180 and 180." });
  }
  if (isNaN(radius) || radius < 1 || radius > 200) {
    return res.status(400).json({ success: false, message: "radius_meters must be between 1 and 200 meters." });
  }

  try {
    const society = await Society.findByPk(targetSocietyId);
    if (!society) {
      return res.status(404).json({ success: false, message: "Society not found." });
    }

    const socName = (society.name || "").trim();
    let finalAddress = society.address;

    if (address && typeof address === "string" && address.trim()) {
      let rawAddr = address.trim();
      // Remove any duplicate occurrences of society name at the start of rawAddr
      if (socName) {
        const escapedName = socName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const socRegex = new RegExp(`^${escapedName}[,\\s-]*`, "i");
        if (socRegex.test(rawAddr)) {
          rawAddr = rawAddr.replace(socRegex, "").trim();
        }
        rawAddr = rawAddr.replace(/^[,\s-]+|[,\s-]+$/g, "").trim();
        finalAddress = rawAddr ? `${socName}, ${rawAddr}` : socName;
      } else {
        finalAddress = rawAddr;
      }
    }

    const updateFields = {
      latitude: lat,
      longitude: lng,
      location_radius: radius,
    };
    if (finalAddress !== undefined && finalAddress !== null) {
      updateFields.address = finalAddress;
    }

    await society.update(updateFields);

    return res.status(200).json({
      success: true,
      message: "Geofence updated successfully.",
      society_name: society.name,
      address: finalAddress,
      geofence: {
        latitude: lat,
        longitude: lng,
        radius_meters: radius,
        address: finalAddress,
      },
    });
  } catch (err) {
    console.error("updateSocietyGeofence error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createSociety,
  getAllSociety,
  getSocietyDetail,
  deleteSociety,
  getSocietyTheme,
  updateSocietyTheme,
  resetSocietyTheme,
  getSocietyGeofence,
  updateSocietyGeofence,
};