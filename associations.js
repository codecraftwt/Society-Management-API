// // const User = require("./models/User");
// // const Society = require("./models/Society");
// // const Block = require("./models/Block");
// // const Flat = require("./models/Flat");
// // const Bill = require("./models/Bill");
// // const Payment = require("./models/Payment");
// // const Notice = require("./models/Notice");
// // const Complaint = require("./models/Complaint");
// // const VisitorLog = require("./models/VisitorLog");
// // const Floor = require("./models/Floor");


// // // 1. Users → Society
// // Society.hasMany(User, { foreignKey: "society_id" });
// // User.belongsTo(Society, { foreignKey: "society_id" });

// // //2. Block -> Society
// // Society.hasMany(Block, { foreignKey : "society_id"});
// // Block.belongsTo(Society, { foreignKey : "society_id"});

// // //3.Flat -> Block
// // Block.hasMany(Flat, { foreignKey : "block_id"} );
// // Flat.belongsTo(Block, { foreignKey : "block_id"});

// // //4.Flat -> Resident(User)
// // User.hasOne(Flat,{ foreignKey : "resident_id"});
// // Flat.belongsTo(User, {foreignKey : "resident_id"});

// // //5.Bill -> Flat
// // Flat.hasMany(Bill, {foreignKey : "flat_id"});
// // Bill.belongsTo(Flat, { foreignKey : "flat_id"});

// // //6. Payment -> Bill
// // Bill.hasMany(Payment, {foreignKey : "bill_id"});
// // Payment.belongsTo(Bill, {foreignKey : "bill_id"});

// // //7. Complaint -> User
// // User.hasMany(Complaint, {foreignKey : "resident_id"});
// // Complaint.belongsTo(User, {foreignKey: "resident_id"});

// // //8. Complaint -> Society
// // Society.hasMany(Complaint, {foreignKey : "society_id"});
// // Complaint.belongsTo(Society, {foreignKey: "society_id"});

// // // 9. Notices → Society
// // Society.hasMany(Notice, { foreignKey: "society_id" });
// // Notice.belongsTo(Society, { foreignKey: "society_id" });

// // // 10. VisitorLogs → Users + Flats
// // User.hasMany(VisitorLog, { foreignKey: "guard_id" });
// // VisitorLog.belongsTo(User, { foreignKey: "guard_id" });
// // Flat.hasMany(VisitorLog, { foreignKey: "flat_id" });
// // VisitorLog.belongsTo(Flat, { foreignKey: "flat_id" });

// // module.exports = {
// //   User, Society, Block, Flat, Bill, Payment, Complaint, Notice, VisitorLog
// // };


// const User = require("./models/User");
// const Society = require("./models/Society");
// const Block = require("./models/Block");
// const Floor = require("./models/Floor"); // 1. Import Floor
// const Flat = require("./models/Flat");
// const Bill = require("./models/Bill");
// const Payment = require("./models/Payment");
// const Notice = require("./models/Notice");
// const Complaint = require("./models/Complaint");
// const VisitorLog = require("./models/VisitorLog");


// // 1. Users → Society
// Society.hasMany(User, { foreignKey: "society_id" });
// User.belongsTo(Society, { foreignKey: "society_id" });

// // 2. Block -> Society
// Society.hasMany(Block, { foreignKey : "society_id"});
// Block.belongsTo(Society, { foreignKey : "society_id"});

// // 3. Floor -> Block (NEW)
// Block.hasMany(Floor, { foreignKey : "block_id"} );
// Floor.belongsTo(Block, { foreignKey : "block_id"});

// // 4. Flat -> Floor (UPDATED)
// Floor.hasMany(Flat, { foreignKey : "floor_id"} );
// Flat.belongsTo(Floor, { foreignKey : "floor_id"});

// // 5. Flat -> Resident(User)
// User.hasOne(Flat,{ foreignKey : "resident_id"});
// Flat.belongsTo(User, {foreignKey : "resident_id"});

// // 6. Bill -> Flat
// Flat.hasMany(Bill, {foreignKey : "flat_id"});
// Bill.belongsTo(Flat, { foreignKey : "flat_id"});

// // 7. Payment -> Bill
// Bill.hasMany(Payment, {foreignKey : "bill_id"});
// Payment.belongsTo(Bill, {foreignKey : "bill_id"});

// // 8. Complaint -> User
// User.hasMany(Complaint, {foreignKey : "resident_id"});
// Complaint.belongsTo(User, {foreignKey: "resident_id"});

// // 9. Complaint -> Society
// Society.hasMany(Complaint, {foreignKey : "society_id"});
// Complaint.belongsTo(Society, {foreignKey: "society_id"});

// // 10. Notices → Society
// Society.hasMany(Notice, { foreignKey: "society_id" });
// Notice.belongsTo(Society, { foreignKey: "society_id" });

// // 11. VisitorLogs → Users + Flats
// User.hasMany(VisitorLog, { foreignKey: "guard_id" });
// VisitorLog.belongsTo(User, { foreignKey: "guard_id" });
// Flat.hasMany(VisitorLog, { foreignKey: "flat_id" });
// VisitorLog.belongsTo(Flat, { foreignKey: "flat_id" });

// // 2. Export Floor along with others
// module.exports = {
//   User, Society, Block, Floor, Flat, Bill, Payment, Complaint, Notice, VisitorLog
// };

const User = require("./models/User");
const Society = require("./models/Society");
const Block = require("./models/Block");
const Floor = require("./models/Floor");
const Flat = require("./models/Flat");
const Bill = require("./models/Bill");
const Payment = require("./models/Payment");
const Notice = require("./models/Notice");
const Complaint = require("./models/Complaint");
const VisitorLog = require("./models/VisitorLog");
const FlatMembership = require("./models/FlatMembership");

// 1. Users → Society
Society.hasMany(User, { foreignKey: "society_id" });
User.belongsTo(Society, { foreignKey: "society_id" });

// 2. Block -> Society
Society.hasMany(Block, { foreignKey : "society_id"});
Block.belongsTo(Society, { foreignKey : "society_id"});

// 3. Floor -> Block
Block.hasMany(Floor, { foreignKey : "block_id"} );
Floor.belongsTo(Block, { foreignKey : "block_id"});

// 4. Flat -> Floor (For Apartments)
Floor.hasMany(Flat, { foreignKey : "floor_id"} );
Flat.belongsTo(Floor, { foreignKey : "floor_id"});

// 5. Flat -> Block (🚨 CRITICAL FIX: Direct link for Row Houses & Universal queries)
Block.hasMany(Flat, { foreignKey : "block_id"} );
Flat.belongsTo(Block, { foreignKey : "block_id"});

// 6. Flat -> Resident(User)
User.hasOne(Flat,{ foreignKey : "resident_id"});
Flat.belongsTo(User, {foreignKey : "resident_id"});

// 7. Bill -> Flat
Flat.hasMany(Bill, {foreignKey : "flat_id"});
Bill.belongsTo(Flat, { foreignKey : "flat_id"});

// 8. Payment -> Bill
Bill.hasMany(Payment, {foreignKey : "bill_id"});
Payment.belongsTo(Bill, {foreignKey : "bill_id"});

// 9. Complaint -> User
User.hasMany(Complaint, {foreignKey : "resident_id"});
Complaint.belongsTo(User, {foreignKey: "resident_id"});

// 10. Complaint -> Society
Society.hasMany(Complaint, {foreignKey : "society_id"});
Complaint.belongsTo(Society, {foreignKey: "society_id"});

// 11. Notices → Society
Society.hasMany(Notice, { foreignKey: "society_id" });
Notice.belongsTo(Society, { foreignKey: "society_id" });

// 12. VisitorLogs → Users + Flats
User.hasMany(VisitorLog, { foreignKey: "guard_id" });
VisitorLog.belongsTo(User, { foreignKey: "guard_id" });
Flat.hasMany(VisitorLog, { foreignKey: "flat_id" });
VisitorLog.belongsTo(Flat, { foreignKey: "flat_id" });

User.hasMany(FlatMembership, { foreignKey: "user_id" });
FlatMembership.belongsTo(User, { foreignKey: "user_id" });

// Flat <-> Complaint
Flat.hasMany(Complaint, { foreignKey: "flat_id" });
Complaint.belongsTo(Flat, { foreignKey: "flat_id" });

module.exports = {
  User, Society, Block, Floor, Flat, Bill, Payment, Complaint, Notice, VisitorLog, FlatMembership
};