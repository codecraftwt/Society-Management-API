const { Flat, HouseHoldMember, FlatMembership, Block } = require("../models");

const attachFlatId = async (req, res, next) => {
  try {
    const societyId = req.user.society_id;
    const requestedFlatId = req.query.flat_id
      ? parseInt(req.query.flat_id, 10)
      : (req.body && req.body.flat_id ? parseInt(req.body.flat_id, 10) : null);

    const blockInclude = societyId
      ? [
          {
            model: Block,
            where: { society_id: societyId },
            required: true,
            attributes: [],
          },
        ]
      : [];

    // 🔹 If specific flat_id is requested, verify user has access to it
    if (requestedFlatId) {
      // Check FlatMembership
      const membership = await FlatMembership.findOne({
        where: { user_id: req.user.id, flat_id: requestedFlatId, is_current: true },
        include: [{ model: Flat, required: true, include: blockInclude }],
      });
      if (membership && membership.Flat) {
        req.flatId = membership.flat_id;
        req.isPrimaryResident = membership.role === "OWNER" || membership.role === "TENANT";
        req.hasBillAccess = membership.pays_maintenance !== false;
        return next();
      }

      // Check Flat.resident_id
      const directFlat = await Flat.findOne({
        where: { id: requestedFlatId, resident_id: req.user.id },
        include: blockInclude,
      });
      if (directFlat) {
        req.flatId = directFlat.id;
        req.isPrimaryResident = true;
        req.hasBillAccess = true;
        return next();
      }

      // Check HouseHoldMember
      const hhMember = await HouseHoldMember.findOne({
        where: { user_id: req.user.id, flat_id: requestedFlatId },
        include: [{ model: Flat, required: true, include: blockInclude }],
      });
      if (hhMember) {
        if (!hhMember.isAdmin) {
          return res.status(403).json({
            code: "ACCOUNT_INACTIVE",
            message: "Access denied. Please connect to the admin or owner of the house.",
          });
        }
        req.flatId = hhMember.flat_id;
        req.isPrimaryResident = false;
        req.hasBillAccess = Boolean(hhMember.isAdmin);
        return next();
      }
    }

    // 🔹 1. Check FlatMembership first (multi-society / active membership)
    if (societyId) {
      const membership = await FlatMembership.findOne({
        where: { user_id: req.user.id, society_id: societyId, is_current: true },
        include: [
          {
            model: Flat,
            required: true,
            include: blockInclude,
          },
        ],
      });
      if (membership && membership.Flat) {
        req.flatId = membership.flat_id;
        req.isPrimaryResident = membership.role === "OWNER" || membership.role === "TENANT";
        req.hasBillAccess = membership.pays_maintenance !== false;
        return next();
      }
    }

    // 🔹 2. Primary Resident via Flat.resident_id
    const flat = await Flat.findOne({
      where: { resident_id: req.user.id },
      include: blockInclude,
    });

    if (flat) {
      req.flatId = flat.id;
      req.isPrimaryResident = true;
      req.hasBillAccess = true;
      return next();
    }

    // 🔹 3. Household Member
    const member = await HouseHoldMember.findOne({
      where: { user_id: req.user.id },
      include: [
        {
          model: Flat,
          required: true,
          include: blockInclude,
        },
      ],
    });

    if (member) {
      if (!member.isAdmin) {
        return res.status(403).json({
          code: "ACCOUNT_INACTIVE",
          message: "Access denied. Please connect to the admin or owner of the house.",
        });
      }
      req.flatId = member.flat_id;
      req.isPrimaryResident = false;
      req.hasBillAccess = Boolean(member.isAdmin);
      return next();
    }

    return res.status(403).json({
      message: "No flat assigned to this user in the active society",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = attachFlatId;
