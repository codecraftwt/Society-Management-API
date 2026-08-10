const { Flat, HouseHoldMember } = require("../models");

const attachFlatId = async (req, res, next) => {
  try {

    // 🔹 Primary Resident
    const flat = await Flat.findOne({
      where: { resident_id: req.user.id },
    });

    if (flat) {
      req.flatId = flat.id;
      req.isPrimaryResident = true;
      req.hasBillAccess = true;
      return next();
    }

    // 🔹 Household Member
    const member = await HouseHoldMember.findOne({
      where: { user_id: req.user.id },
    });

    if (member) {
      req.flatId = member.flat_id;
      req.isPrimaryResident = false;

      // ✅ FIX HERE
      req.hasBillAccess = Boolean(member.isAdmin);
      console.log("IS ADMIN VALUE:", member.isAdmin);
       console.log("HAS BILL ACCESS:", Boolean(member.isAdmin));
      return next();
    }

    return res.status(403).json({
      message: "No flat assigned to this user",
    });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = attachFlatId;