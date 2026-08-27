require("dotenv").config();
const bcrypt = require("bcryptjs");
const sequelize = require("../config/db");
const User = require("../models/User");

const seedSuperAdmin = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    const existing = await User.findOne({ where: { email: "superadmin@society.com" } });
    if (existing) {
      console.log("ℹ️  Super Admin already exists (id:", existing.id, "). Skipping seed.");
      process.exit(0);
    }

    const hashedPass = await bcrypt.hash("123456", 10);

    const superAdmin = await User.create({
      name: "Super Admin",
      email: "superadmin@society.com",
      password: hashedPass,
      role: "SUPER_ADMIN",
      roles: ["SUPER_ADMIN"],
      status: "ACTIVE",
      society_id: null,
    });

    console.log("✅ Super Admin seeded:", superAdmin.email, "(id:", superAdmin.id, ")");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
};

seedSuperAdmin();