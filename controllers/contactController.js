// controllers/contactController.js
const { Op } = require("sequelize");
const User = require("../models/User");

exports.getSocietyContacts = async (req, res) => {
  try {
    const societyId = req.user?.societyId || req.user?.society_id;

    if (!societyId) {
      return res.status(403).json({
        success: false,
        message: "Society context not found for this user.",
      });
    }

    // ── 1. SUPER_ADMINs — platform-wide, no society filter ──
    const superAdmins = await User.findAll({
      where: {
        status: "ACTIVE",
        [Op.or]: [
          { role: "SUPER_ADMIN" },
          { roles: { [Op.like]: "%SUPER_ADMIN%" } },
        ],
      },
      attributes: ["id", "name", "phone", "email", "role", "roles"],
    });

    // ── 2. SOCIETY_ADMIN — scoped to this society only ──
    const societyAdmins = await User.findAll({
      where: {
        status: "ACTIVE",
        society_id: societyId,   // ✅ snake_case only
        [Op.or]: [
          { role: "SOCIETY_ADMIN" },
          { roles: { [Op.like]: "%SOCIETY_ADMIN%" } },
        ],
      },
      attributes: ["id", "name", "phone", "email", "role", "roles"],
    });

    // ── 3. COMMITTEE_MEMBERs — scoped to this society only ──
    const committeeMembers = await User.findAll({
      where: {
        status: "ACTIVE",
        society_id: societyId,   // ✅ snake_case only
        [Op.or]: [
          { role: "COMMITTEE_MEMBER" },
          { roles: { [Op.like]: "%COMMITTEE_MEMBER%" } },
        ],
      },
      attributes: ["id", "name", "phone", "email", "role", "roles"],
    });

    // ── Merge & deduplicate by id ──
    const seen = new Set();
    const allContacts = [
      ...superAdmins,
      ...societyAdmins,
      ...committeeMembers,
    ].filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

    res.status(200).json({
      success: true,
      count: allContacts.length,
      data: allContacts,
    });
  } catch (error) {
    console.error("❌ getSocietyContacts error =>", error.message);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};