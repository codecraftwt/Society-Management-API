const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ComplaintReadStatus = sequelize.define("ComplaintReadStatus", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  complaint_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  last_read_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  tableName: "complaint_read_status",
  timestamps: false,
});

module.exports = ComplaintReadStatus;