const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const BillLateFeeWaiver = sequelize.define(
  "BillLateFeeWaiver",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    bill_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "bills", key: "id" },
    },
    waiver_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    waived_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
  },
  {
    tableName: "bill_late_fee_waivers",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_bill_late_fee_waivers_bill",
        fields: ["bill_id"],
      },
    ],
  }
);

module.exports = BillLateFeeWaiver;
