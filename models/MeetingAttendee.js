const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MeetingAttendee = sequelize.define(
  "MeetingAttendee",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    meeting_id: { type: DataTypes.INTEGER, allowNull: false },
    society_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: true },
    attendance_status: {
      type: DataTypes.ENUM("PRESENT", "ABSENT"),
      allowNull: false,
      defaultValue: "ABSENT",
    },
    member_name_snapshot: { type: DataTypes.STRING(255), allowNull: false },
    member_role_snapshot: { type: DataTypes.STRING(100), allowNull: true },
    flat_info_snapshot: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: "meeting_attendees",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_meeting_attendee",
        fields: ["meeting_id", "user_id"],
      },
      { fields: ["meeting_id", "attendance_status"] },
      { fields: ["society_id", "user_id"] },
    ],
  }
);

module.exports = MeetingAttendee;
