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
    const societies = await Society.findAll({
      include: [
        {
          model: User,
          where: { role: "SOCIETY_ADMIN" },
          required: false,
          attributes: ["id", "name", "email"],
        },
      ],
    });

    const formatted = societies.map(s => ({
      id: s.id,
      name: s.name,
      address: s.address,
      societyAdmins:
        s.Users.length > 0
          ? {
              id: s.Users[0].id,
              name: s.Users[0].name,
              email: s.Users[0].email,
            }
          : null,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
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

module.exports = { createSociety, getAllSociety, getSocietyDetail, deleteSociety };