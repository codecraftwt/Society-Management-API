const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Notification = sequelize.define("Notification", {

  title: DataTypes.STRING,

  message: DataTypes.TEXT,

  type: DataTypes.STRING,
  action_type: DataTypes.STRING,
  action_route: DataTypes.STRING,

  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },

  society_id: DataTypes.INTEGER,

  user_id: DataTypes.INTEGER,

  receiver_role: DataTypes.STRING,

  receiver_user_id: DataTypes.INTEGER

}, {
  tableName: "notifications"
});

module.exports = Notification;


