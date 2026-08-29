const sequelize = require("../config/db");
// Import CLASS models
const User = require("./User");
const Society = require("./Society");
const Block = require("./Block");
const Flat = require("./Flat");
const Bill = require("./Bill");
const Payment = require("./Payment");
const Notice = require("./Notice");
const Complaint = require("./Complaint");
const VisitorLog = require("./VisitorLog");
const HouseHoldMember = require("./HouseHoldMember");
const EmergencyAlert = require("./EmergencyAlert");
const VisitorPreApproval = require("./VisitorPreApproval");
const GuardShift = require("./GuardShift");
const Notification = require("./Notification"); 
const Vehicle = require("./Vehicle");
const ParkingRequest = require("./ParkingRequest");
const Parcel = require("./Parcel");
const ParkingSlot = require("./ParkingSlot");
const Amenity = require("./Amenity");
const AmenityBooking = require("./AmenityBooking");
const GuardLog = require("./GuardLog");
const UserSetting = require("./UserSetting");
const ComplaintComment = require("./ComplaintComment");
const Document = require("./Document");
const ResidentHistory = require("./ResidentHistory");
const Floor = require("./Floor");
const UserDocuments = require("./UserDocuments");
const FlatMembership = require("./FlatMembership");
const BillingRule = require("./BillingRule");



User.hasMany(VisitorPreApproval, { foreignKey: "resident_id" });
VisitorPreApproval.belongsTo(User, { foreignKey: "resident_id" });

/* ====
   ASSOCIATIONS
==== */

// 1. Users → Society
Society.hasMany(User, { foreignKey: "society_id" });
User.belongsTo(Society, { foreignKey: "society_id" });

// 2. Block → Society
Society.hasMany(Block, { foreignKey: "society_id" });
Block.belongsTo(Society, { foreignKey: "society_id" });



// 3. Floor → Block
Block.hasMany(Floor, { foreignKey: "block_id", onDelete: "CASCADE" });
Floor.belongsTo(Block, { foreignKey: "block_id" });

// 4. Flat → Floor
Floor.hasMany(Flat, { foreignKey: "floor_id", onDelete: "CASCADE" });
Flat.belongsTo(Floor, { foreignKey: "floor_id" });

Block.hasMany(Flat, { foreignKey: "block_id" });
Flat.belongsTo(Block, { foreignKey: "block_id" });

// 4. Flat → Resident(User)
User.hasOne(Flat, { foreignKey: "resident_id" });
Flat.belongsTo(User, { foreignKey: "resident_id" });

// 5. Bill → Flat
Flat.hasMany(Bill, { foreignKey: "flat_id" });
Bill.belongsTo(Flat, { foreignKey: "flat_id" });

// 6. Payment → Bill
Bill.hasMany(Payment, { foreignKey: "bill_id" });
Payment.belongsTo(Bill, { foreignKey: "bill_id" });

// 7. Complaint → User
User.hasMany(Complaint, { foreignKey: "resident_id" });
Complaint.belongsTo(User, { foreignKey: "resident_id" });

// 8. Complaint → Society
Society.hasMany(Complaint, { foreignKey: "society_id" });
Complaint.belongsTo(Society, { foreignKey: "society_id" });

// 9. Notices → Society
Society.hasMany(Notice, { foreignKey: "society_id" });
Notice.belongsTo(Society, { foreignKey: "society_id" });

/* ====
   VISITOR ASSOCIATIONS
==== */

// Visitor → Guard (User)
User.hasMany(VisitorLog, {
  foreignKey: "guard_id",
  as: "GuardVisitors",
});

VisitorLog.belongsTo(User, {
  foreignKey: "guard_id",
  as: "Guard",
});

// Visitor → Flat
Flat.hasMany(VisitorLog, {
  foreignKey: "flat_id",
  as: "Visitors",
});

VisitorLog.belongsTo(Flat, {
  foreignKey: "flat_id",
});
VisitorLog.belongsTo(Flat, {
  foreignKey: "flat_id",
});
Society.hasMany(VisitorLog, {
  foreignKey: "society_id",
});

VisitorLog.belongsTo(Society, {
  foreignKey: "society_id",
});


// Flat → Floor (Adjusted for Visitor include chaining)
Flat.belongsTo(Floor, { foreignKey: "floor_id" });
Floor.hasMany(Flat, { foreignKey: "floor_id" });

User.hasMany(VisitorPreApproval, { foreignKey: "resident_id" });
VisitorPreApproval.belongsTo(User, { foreignKey: "resident_id" });

ParkingRequest.belongsTo(User, {
  foreignKey: "resident_id",
  as: "resident"
});

ParkingRequest.belongsTo(Flat, {
  foreignKey: "flat_id"
});


/* ====
   HOUSEHOLD MEMBERS
==== */

Flat.hasMany(HouseHoldMember, {
  foreignKey: "flat_id",
  onDelete: "CASCADE",
});

HouseHoldMember.belongsTo(Flat, {
  foreignKey: "flat_id",
});

//Emergency Alerts
User.hasMany(EmergencyAlert, { foreignKey: "guard_id" });
EmergencyAlert.belongsTo(User, { foreignKey: "guard_id" });

Society.hasMany(EmergencyAlert, { foreignKey: "society_id" });
EmergencyAlert.belongsTo(Society, { foreignKey: "society_id" });

User.hasMany(EmergencyAlert, { foreignKey: "resident_id" });
EmergencyAlert.belongsTo(User, { foreignKey: "resident_id" });

Flat.hasMany(EmergencyAlert, { foreignKey: "flat_id" });
EmergencyAlert.belongsTo(Flat, { foreignKey: "flat_id" });

EmergencyAlert.belongsTo(User, {
  foreignKey: "resident_id",
  as: "Resident",
});

EmergencyAlert.belongsTo(User, {
  foreignKey: "guard_id",
  as: "Guard",
});

EmergencyAlert.belongsTo(Flat, {
  foreignKey: "flat_id",
});




User.hasMany(GuardShift, { foreignKey: "guard_id" });
GuardShift.belongsTo(User, { foreignKey: "guard_id" });

Society.hasMany(GuardShift, { foreignKey: "society_id" });
GuardShift.belongsTo(Society, { foreignKey: "society_id" });


Society.hasMany(Notification, { foreignKey: "society_id" });
Notification.belongsTo(Society, { foreignKey: "society_id" });

Notification.belongsTo(User, {
  foreignKey: "user_id"
});

User.hasMany(Notification, {
  foreignKey: "user_id"
});

// === VEHICLE RELATIONS ===

// Resident owns many vehicles
User.hasMany(Vehicle, { foreignKey: "resident_id" });
Vehicle.belongsTo(User, { foreignKey: "resident_id" });

// Flat contains many vehicles
Flat.hasMany(Vehicle, { foreignKey: "flat_id" });
Vehicle.belongsTo(Flat, { foreignKey: "flat_id" });

// Society contains many vehicles
Society.hasMany(Vehicle, { foreignKey: "society_id" });
Vehicle.belongsTo(Society, { foreignKey: "society_id" });

Parcel.belongsTo(User, {
  foreignKey: "resident_id",
  as: "resident"
});

Parcel.belongsTo(Flat, {
  foreignKey: "flat_id"
});

User.hasMany(GuardShift, { foreignKey: "guard_id" });
GuardShift.belongsTo(User, { foreignKey: "guard_id" });
Society.hasMany(GuardShift, { foreignKey: "society_id" });
GuardShift.belongsTo(Society, { foreignKey: "society_id" });

ParkingSlot.belongsTo(Society, { foreignKey: "society_id" });
Society.hasMany(ParkingSlot, { foreignKey: "society_id" });

ParkingSlot.belongsTo(Flat, { foreignKey: "flat_id" });
Flat.hasMany(ParkingSlot, { foreignKey: "flat_id" });

ParkingSlot.belongsTo(User, { foreignKey: "resident_id", as: "resident" });
User.hasMany(ParkingSlot, { foreignKey: "resident_id", as: "parkingSlots" });

Society.hasMany(Amenity, { foreignKey: "society_id" });
Amenity.belongsTo(Society, { foreignKey: "society_id" });

// Society <-> AmenityBooking
Society.hasMany(AmenityBooking, { foreignKey: "society_id" });
AmenityBooking.belongsTo(Society, { foreignKey: "society_id" });

// Amenity <-> AmenityBooking
Amenity.hasMany(AmenityBooking, { foreignKey: "amenity_id" });
AmenityBooking.belongsTo(Amenity, { foreignKey: "amenity_id" });

// User <-> AmenityBooking
User.hasMany(AmenityBooking, { foreignKey: "user_id" });
AmenityBooking.belongsTo(User, { foreignKey: "user_id" });

// Flat <-> AmenityBooking
Flat.hasMany(AmenityBooking, { foreignKey: "flat_id" });
AmenityBooking.belongsTo(Flat, { foreignKey: "flat_id" });


/* ====
   GUARD LOG ASSOCIATIONS
==== */
// GuardLog -> User (Author)
GuardLog.belongsTo(User, { foreignKey: "guard_id", as: "author" });
User.hasMany(GuardLog, { foreignKey: "guard_id" });

// GuardLog -> Society
GuardLog.belongsTo(Society, { foreignKey: "society_id" });
Society.hasMany(GuardLog, { foreignKey: "society_id" });


/* ====
   EXPORTS
==== */


/* ==== HOUSEHOLD ASSOCIATIONS ==== */

// Flat → Household Members
Flat.hasMany(HouseHoldMember, {
  foreignKey: "flat_id",
  onDelete: "CASCADE",
});
HouseHoldMember.belongsTo(Flat, {
  foreignKey: "flat_id",
});

// Link User <-> HouseholdMember (IMPORTANT)
HouseHoldMember.belongsTo(User, {
  foreignKey: "user_id",
});
User.hasMany(HouseHoldMember, { foreignKey: "user_id" });


User.hasOne(UserSetting, { foreignKey: "user_id", onDelete: "CASCADE" });
UserSetting.belongsTo(User, { foreignKey: "user_id" });





// 2. Associations — add after your existing ones
Document.belongsTo(User, { foreignKey: "uploaded_by", as: "uploader" });
User.hasMany(Document,   { foreignKey: "uploaded_by", as: "uploadedDocs" });

Document.belongsTo(Society, { foreignKey: "society_id" });
Society.hasMany(Document,   { foreignKey: "society_id" });

// 3. Add Document to the exports object at the bottom




// Complaint associations
Complaint.belongsTo(User, { foreignKey: "resident_id" });
User.hasMany(Complaint, { foreignKey: "resident_id" });

// ComplaintComment associations
ComplaintComment.belongsTo(User, { foreignKey: "user_id" });
User.hasMany(ComplaintComment, { foreignKey: "user_id" });

ComplaintComment.belongsTo(Complaint, { foreignKey: "complaint_id" });
Complaint.hasMany(ComplaintComment, { foreignKey: "complaint_id" });

Complaint.belongsTo(Flat, { foreignKey: "flat_id" });
Flat.hasMany(Complaint, { foreignKey: "flat_id" });




// Flat ↔ ResidentHistory
Flat.hasMany(ResidentHistory, { foreignKey: "flat_id" });
ResidentHistory.belongsTo(Flat, { foreignKey: "flat_id" });

// User ↔ ResidentHistory
User.hasMany(ResidentHistory, { foreignKey: "user_id" });
ResidentHistory.belongsTo(User, { foreignKey: "user_id" });

User.hasOne(UserDocuments, { foreignKey: "user_id" });
UserDocuments.belongsTo(User, { foreignKey: "user_id" });

User.hasMany(FlatMembership, { foreignKey: "user_id" });
FlatMembership.belongsTo(User, { foreignKey: "user_id" });

Flat.hasMany(FlatMembership, { foreignKey: "flat_id" });
FlatMembership.belongsTo(Flat, { foreignKey: "flat_id" });

// ParkingSlot ↔ Vehicle
ParkingSlot.hasOne(Vehicle, {
  foreignKey: "parking_slot_id",
  as: "Vehicle",
});

Vehicle.belongsTo(ParkingSlot, {
  foreignKey: "parking_slot_id",
});



Flat.hasMany(VisitorPreApproval, {
  foreignKey: "flat_id",
});

VisitorPreApproval.belongsTo(Flat, {
  foreignKey: "flat_id",
});

module.exports = {
  sequelize,
  User,
  Society,
  Block,
  Floor,
  Flat,
  Bill,
  Payment,
  Complaint,
  Notice,
  VisitorLog,
  HouseHoldMember,
  EmergencyAlert,
  VisitorPreApproval,
  Notification,
  Vehicle,
  ParkingRequest,
  Parcel,
  GuardShift,
  ParkingSlot,
  Amenity,
  AmenityBooking,
  GuardLog,
  ResidentHistory,
  UserSetting,
  Document,
  ComplaintComment,
  UserDocuments,
  FlatMembership,
  BillingRule,
};
