const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Notice = sequelize.define("Notice", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  society_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  file_url: { type: DataTypes.STRING, allowNull: true },
  acknowledgement_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  target_type: {
    type: DataTypes.ENUM("SOCIETY", "FLAT"),
    allowNull: false,
    defaultValue: "SOCIETY"
  },
  target_flat_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  created_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  created_by_name: { type: DataTypes.STRING, allowNull: true },
  created_by_role: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: "notices",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false
});

module.exports = Notice;

