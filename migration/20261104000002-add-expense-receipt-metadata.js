"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("expenses", "receipt_file_name", { type: Sequelize.STRING(255), allowNull: true });
    await queryInterface.addColumn("expenses", "receipt_mime_type", { type: Sequelize.STRING(100), allowNull: true });
    await queryInterface.addColumn("expenses", "receipt_file_size", { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn("expenses", "receipt_public_id", { type: Sequelize.STRING(500), allowNull: true });
  },
  async down(queryInterface) {
    for (const c of ["receipt_file_name", "receipt_mime_type", "receipt_file_size", "receipt_public_id"]) await queryInterface.removeColumn("expenses", c);
  },
};
