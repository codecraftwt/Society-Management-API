const { HouseHoldMember, User, Flat } = require("../models");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { sendEmail } = require("../services/emailService");

// ✅ Helper: safely parse roles — always returns a plain array
const parseRoles = (roles) => {
  if (!roles) return [];
  if (Array.isArray(roles)) return [...roles];
  try {
    const parsed = JSON.parse(roles);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/* =
   GET MY HOUSEHOLD
= */
exports.getMyHousehold = async (req, res) => {
  try {
    const members = await HouseHoldMember.findAll({
      where: { flat_id: req.flatId },
      order: [["created_at", "ASC"]],
    });

    res.json(members);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   ADD HOUSEHOLD MEMBER
= */
exports.addHouseholdMember = async (req, res) => {
  try {
    if (!req.isPrimaryResident) {
      return res.status(403).json({
        message: "Only the primary resident can add members",
      });
    }

    const { name, phone, email, relation, work } = req.body;

    let createdUser = null;

    if (!work && email) {
      const existingUser = await User.findOne({ where: { email } });

      if (existingUser) {
        await existingUser.update({
          role: "FAMILY_MEMBER",
          roles: ["FAMILY_MEMBER"], // ✅ plain array, Sequelize handles JSON
        });

        createdUser = existingUser;
      } else {
        const tempPassword = "123456";
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        createdUser = await User.create({
          name,
          email,
          phone: phone || null,
          password: hashedPassword,
          role: "FAMILY_MEMBER",
          roles: ["FAMILY_MEMBER"], // ✅ plain array
          society_id: req.user.society_id,
          status: "ACTIVE",
          approval_status: "APPROVED",
        });
      }
    }

    const member = await HouseHoldMember.create({
      name,
      phone: phone || null,
      relation: work ? "Daily Help" : relation,
      work: work || null,
      email: email || null,
      flat_id: req.flatId,
      user_id: createdUser ? createdUser.id : null,
      isAdmin: false,
    });

    res.status(201).json({
      message: "Household member added successfully",
      member,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   TOGGLE ADMIN ACCESS
= */
exports.toggleAdminAccess = async (req, res) => {
  try {
    if (!req.isPrimaryResident) {
      return res.status(403).json({
        message: "Only the primary resident can change admin access",
      });
    }

    const { id } = req.params;

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    if (member.work) {
      return res.status(400).json({
        message: "Daily helpers cannot be granted admin access",
      });
    }

    // ✅ GRANT ADMIN
    if (!member.isAdmin) {

      if (member.user_id) {
        const existingUser = await User.findByPk(member.user_id);
        if (existingUser) {
          let roles = parseRoles(existingUser.roles);
          if (!roles.includes("RESIDENT")) roles.push("RESIDENT");

          await existingUser.update({
            role: "RESIDENT",
            roles, // ✅ plain array
            status: "ACTIVE",
            approval_status: "APPROVED",
          });
        }

        member.isAdmin = true;
        await member.save();

        return res.json({ message: "Admin access granted", isAdmin: true });
      }

      if (!member.email) {
        return res.status(400).json({
          message: "Email required to grant admin access",
        });
      }

      const existing = await User.findOne({ where: { email: member.email } });

      if (existing) {
        let roles = parseRoles(existing.roles);
        if (!roles.includes("RESIDENT")) roles.push("RESIDENT");

        await existing.update({
          role: "RESIDENT",
          roles, // ✅ plain array
          status: "ACTIVE",
          approval_status: "APPROVED",
        });

        member.user_id = existing.id;
        member.isAdmin = true;
        await member.save();

        return res.json({ message: "Admin access granted", isAdmin: true });
      }

      const tempPassword = "123456";
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const newUser = await User.create({
        name: member.name,
        email: member.email,
        phone: member.phone || null,
        password: hashedPassword,
        role: "RESIDENT",
        roles: ["RESIDENT"], // ✅ plain array
        society_id: req.user.society_id,
        status: "ACTIVE",
        approval_status: "APPROVED",
      });

      member.user_id = newUser.id;
      member.isAdmin = true;
      await member.save();

      res.json({ message: "Admin access granted and account created", isAdmin: true });

      if (typeof sendEmail === "function") {
        sendEmail({
          to: member.email,
          subject: "You now have access to the Society App",
          html: `<h2>Hello ${member.name}!</h2>`,
        }).catch((err) => console.log("Admin grant email failed:", err.message));
      }

      return;
    }

    // ❌ REVOKE ADMIN
    if (member.isAdmin) {
      if (member.user_id) {
        const linkedUser = await User.findByPk(member.user_id);
        if (linkedUser) {
          let roles = parseRoles(linkedUser.roles);
          roles = roles.filter((r) => r !== "RESIDENT");

          if (!roles.includes("FAMILY_MEMBER")) {
            roles.push("FAMILY_MEMBER");
          }

          await linkedUser.update({
            role: "FAMILY_MEMBER",
            roles, // ✅ plain array
          });
        }
      }

      member.isAdmin = false;
      await member.save();

      return res.json({ message: "Admin access revoked", isAdmin: false });
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   REMOVE HOUSEHOLD MEMBER
= */
exports.removeHouseholdMember = async (req, res) => {
  try {
    if (!req.isPrimaryResident) {
      return res.status(403).json({
        message: "Only the primary resident can remove members",
      });
    }

    const { id } = req.params;

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    if (member.user_id) {
      const linkedUser = await User.findByPk(member.user_id);

      if (linkedUser) {
        const isPrimaryElsewhere = await Flat.count({
          where: { resident_id: member.user_id },
        });

        const otherMemberships = await HouseHoldMember.count({
          where: {
            user_id: member.user_id,
            id: { [Op.ne]: member.id },
          },
        });

        if (isPrimaryElsewhere === 0 && otherMemberships === 0) {
          await linkedUser.destroy();
        }
      }
    }

    await member.destroy();

    res.json({ message: "Member removed successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =
   UPDATE HOUSEHOLD MEMBER
= */
exports.updateHouseholdMember = async (req, res) => {
  try {
    if (!req.isPrimaryResident) {
      return res.status(403).json({
        message: "Only the primary resident can update members",
      });
    }

    const { id } = req.params;
    const { name, email, phone } = req.body;

    const member = await HouseHoldMember.findOne({
      where: { id, flat_id: req.flatId },
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;

    await member.update(updateFields);

    if (member.user_id) {
      const linkedUser = await User.findByPk(member.user_id);
      if (linkedUser) {
        await linkedUser.update(updateFields);
      }
    } else if (!member.work && email) {
      const existingUser = await User.findOne({ where: { email } });

      if (!existingUser) {
        const tempPassword = "123456";
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        const newUser = await User.create({
          name: name || member.name,
          email,
          phone: phone || member.phone || null,
          password: hashedPassword,
          role: "FAMILY_MEMBER",
          roles: ["FAMILY_MEMBER"], // ✅ plain array
          society_id: req.user.society_id,
          status: "ACTIVE",
          approval_status: "APPROVED",
        });

        await member.update({ user_id: newUser.id });

      } else {
        await existingUser.update({
          role: "FAMILY_MEMBER",
          roles: ["FAMILY_MEMBER"], // ✅ plain array
        });

        await member.update({ user_id: existingUser.id });
      }
    }

    res.json({
      message: "Member updated successfully",
      data: member,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};