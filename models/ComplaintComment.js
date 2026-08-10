const { DataTypes } = require("sequelize");
const sequelize     = require("../config/db");

const ComplaintComment = sequelize.define("ComplaintComment", {
  id: {
    type:          DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey:    true,
  },
  complaint_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
  },
  message: {
    type:      DataTypes.TEXT,
    allowNull: true, // now optional if an attachment is sent
  },
  attachment_url: {
    type:      DataTypes.STRING,
    allowNull: true,
  },
  attachment_type: {
    // "image" | "file"
    type:      DataTypes.STRING,
    allowNull: true,
  },
  attachment_name: {
    // original filename, useful for non-image files
    type:      DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName:  "complaint_comments",
  timestamps: true,
  createdAt:  "created_at",
  updatedAt:  false,
});

module.exports = ComplaintComment;