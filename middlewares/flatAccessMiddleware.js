const { Flat, HouseHoldMember, FlatMembership, Block } = require("../models");

const attachFlatId = async (req, res, next) => {
  try {
    const societyId = req.user.society_id;
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