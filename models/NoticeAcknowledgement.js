const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const NoticeAcknowledgement = sequelize.define(
  "NoticeAcknowledgement",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    notice_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    viewed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    acknowledged_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    tableName: "notice_acknowledgements",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["notice_id", "user_id"],
      },
      {
        fields: ["notice_id"],
      },
      {
        fields: ["user_id"],
      },
      {
        fields: ["notice_id", "acknowledged_at"],
      },
    ],
  }
);

module.exports = NoticeAcknowledgement;
