const { Flat, HouseHoldMember } = require("../models");


exports.findAuthorizedFlat = async (userId) => {
  const ownerFlat = await Flat.findOne({ where: { resident_id: userId } });
  if (ownerFlat) return ownerFlat;
  const member = await HouseHoldMember.findOne({
    where: { 
      user_id: userId, 
      is_admin: true 
    }
  });

  if (member) {
    return await Flat.findByPk(member.flat_id);
  }

  return null;
};


exports.getFlatForUser = async (userId) => {
  // 1. Try finding as Primary Owner
  let flat = await Flat.findOne({ 
    where: { resident_id: userId },
    include: [{ model: Block, attributes: ["id", "name", "society_id"] }]
  });
  
  if (flat) return flat;

  // 2. Try finding as Household Member
  const member = await HouseHoldMember.findOne({
    where: { user_id: userId }
  });

  if (member) {
    return await Flat.findByPk(member.flat_id, {
        include: [{ model: Block, attributes: ["id", "name", "society_id"] }]
    });
  }

  return null;
};