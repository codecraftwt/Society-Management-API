require("dotenv").config();
const bcrypt = require("bcryptjs");
const sequelize = require("../config/db");
const User = require("../models/User");

const seedSuperAdmin = async () => {
  try {
    await sequelize.sync();

    const hashedPass = await bcrypt.hash("123456", 10);

    const superAdmin = await User.create({
      name: "Super Admin",
      email: "superadmin@society.com",
      password: hashedPass,

      // 🔥 OLD FIELD (keep if used)
      role: "SUPER_ADMIN",

      // ✅ NEW FIELD (array)
      roles: ["SUPER_ADMIN"],

      status: "ACTIVE",
      society_id: null,
    });

    console.log("Super Admin seeded:", superAdmin.email);
    process.exit();
  } catch (err) {
    console.log(err);
  }
};

seedSuperAdmin();