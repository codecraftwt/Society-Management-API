const { Op } = require("sequelize");

exports.getOverlappingBookings = ({ amenityId, date, startTime, endTime }) => ({
  amenity_id: amenityId,
  date,
  status: { [Op.notIn]: ["CANCELLED", "REJECTED"] },
  [Op.and]: [
    { start_time: { [Op.lt]: endTime } }, // Existing start < New end
    { end_time: { [Op.gt]: startTime } }  // Existing end > New start
  ]
});