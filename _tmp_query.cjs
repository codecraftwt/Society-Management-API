const { FlatMembership, User, Flat, Floor, Block, UserDocuments, sequelize } = require("./models");
const { Op } = require("sequelize");

(async () => {
  const memberships = await FlatMembership.findAll({
    where: { [Op.or]: [{ role: "TENANT" }, { role: "tenant" }] },
    include: [
      {
        model: User,
        attributes: [
          "id", "name", "email", "phone", "approval_status", "status", "resident_type", "society_id",
          "role", "roles",
          "approved_by_user_id", "approved_by_name", "approved_by_role", "approved_at"
        ],
        include: [{ model: UserDocuments, required: false }],
      },
      {
        model: Flat,
        attributes: ["id", "flat_number", "flat_type", "occupancy_status"],
        include: [
          { model: Floor, attributes: ["id", "floor_number"], required: false,
            include: [{ model: Block, attributes: ["id", "name", "society_id"], required: false }] },
          { model: Block, attributes: ["id", "name", "society_id"], required: false },
        ],
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  console.log("membership count:", memberships.length);
  for (const m of memberships.slice(0, 5)) {
    console.log("tenant:", m.User?.name, "| UserDocuments:", JSON.stringify(m.User?.UserDocuments), "| UserDocument:", JSON.stringify(m.User?.UserDocument));
  }
  await sequelize.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
