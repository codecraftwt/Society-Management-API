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
const GuardShiftTiming = require("./GuardShiftTiming");
const GuardShiftPlace = require("./GuardShiftPlace");
const Notification = require("./Notification");
const Vehicle = require("./Vehicle");
const ParkingRequest = require("./ParkingRequest");
const Parcel = require("./Parcel");
const ParkingSlot = require("./ParkingSlot");
const Amenity = require("./Amenity");
const AmenityBooking = require("./AmenityBooking");
const AmenityRule = require("./AmenityRule");
const AmenityRuleAttachment = require("./AmenityRuleAttachment");
const AmenityBookingTermsAcceptance = require("./AmenityBookingTermsAcceptance");
const GuardLog = require("./GuardLog");
const UserSetting = require("./UserSetting");
const ComplaintComment = require("./ComplaintComment");
const Document = require("./Document");
const ResidentHistory = require("./ResidentHistory");
const Floor = require("./Floor");
const UserDocuments = require("./UserDocuments");
const FlatMembership = require("./FlatMembership");
const BillingRule = require("./BillingRule");
const MaintenanceRate = require("./MaintenanceRate");
const MaintenanceLateFeeConfig = require("./MaintenanceLateFeeConfig");
const BillLateFeeWaiver = require("./BillLateFeeWaiver");
const AccountantAssignment = require("./AccountantAssignment");
const RolePermission = require("./RolePermission");
const EmergencyAcknowledgement = require("./EmergencyAcknowledgement");
const Expense = require("./Expense");
const LedgerEntry = require("./LedgerEntry");
const FinancialAuditLog = require("./FinancialAuditLog");
const SocietyFinancialAccount = require("./SocietyFinancialAccount");
const ExpenseCategory = require("./ExpenseCategory");
const FixedDeposit = require("./FixedDeposit");
const FixedDepositTransaction = require("./FixedDepositTransaction");
const CleaningStaff = require("./CleaningStaff");
const CleaningStaffPass = require("./CleaningStaffPass");
const CleaningStaffAttendance = require("./CleaningStaffAttendance");
const GuardAttendance = require("./GuardAttendance");
const Event = require("./Event");
const EventMedia = require("./EventMedia");
const UserSociety = require("./UserSociety");
const UserSocietyRole = require("./UserSocietyRole");
const SocietyInvite = require("./SocietyInvite");
const Rule = require("./Rule");
const RuleVersion = require("./RuleVersion");
const RuleAcknowledgement = require("./RuleAcknowledgement");
const MeetingCategory = require("./MeetingCategory");
const MeetingMinutes = require("./MeetingMinutes");
const MeetingAttendee = require("./MeetingAttendee");



User.hasMany(VisitorPreApproval, { foreignKey: "resident_id" });
VisitorPreApproval.belongsTo(User, { foreignKey: "resident_id" });

/* ====
   ASSOCIATIONS
==== */

// 1. Users → Society
Society.hasMany(User, { foreignKey: "society_id" });
User.belongsTo(Society, { foreignKey: "society_id" });

// 1.1 Multi-Society Memberships & Roles
User.hasMany(UserSociety, { foreignKey: "user_id", as: "memberships" });
UserSociety.belongsTo(User, { foreignKey: "user_id", as: "user" });

Society.hasMany(UserSociety, { foreignKey: "society_id", as: "memberships" });
UserSociety.belongsTo(Society, { foreignKey: "society_id", as: "society" });

UserSociety.hasMany(UserSocietyRole, { foreignKey: "user_society_id", as: "societyRoles" });
UserSocietyRole.belongsTo(UserSociety, { foreignKey: "user_society_id", as: "userSociety" });

Society.hasMany(SocietyInvite, { foreignKey: "society_id", as: "invites" });
SocietyInvite.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Society.hasMany(Bill, { foreignKey: "society_id" });
Bill.belongsTo(Society, { foreignKey: "society_id" });

Society.hasMany(FlatMembership, { foreignKey: "society_id" });
FlatMembership.belongsTo(Society, { foreignKey: "society_id" });

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

// 7. Complaint → User & Flat
User.hasMany(Complaint, { foreignKey: "resident_id" });
Complaint.belongsTo(User, { foreignKey: "resident_id" });
Flat.hasMany(Complaint, { foreignKey: "flat_id" });
Complaint.belongsTo(Flat, { foreignKey: "flat_id" });

// 8. Complaint → Society
Society.hasMany(Complaint, { foreignKey: "society_id" });
Complaint.belongsTo(Society, { foreignKey: "society_id" });

// 9. Notices → Society & Flat
Society.hasMany(Notice, { foreignKey: "society_id" });
Notice.belongsTo(Society, { foreignKey: "society_id" });
Notice.belongsTo(Flat, { foreignKey: "target_flat_id", as: "targetFlat" });
Flat.hasMany(Notice, { foreignKey: "target_flat_id", as: "targetNotices" });


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

EmergencyAlert.belongsTo(User, {
  foreignKey: "admin_id",
  as: "Admin",
});
User.hasMany(EmergencyAlert, { foreignKey: "admin_id", as: "AdminAlerts" });

EmergencyAlert.belongsTo(Flat, {
  foreignKey: "flat_id",
});

EmergencyAlert.belongsTo(User, {
  foreignKey: "resolved_by",
  as: "Resolver",
});
User.hasMany(EmergencyAlert, { foreignKey: "resolved_by", as: "ResolvedAlerts" });

EmergencyAlert.hasMany(EmergencyAcknowledgement, {
  foreignKey: "emergency_alert_id",
  as: "acknowledgements",
  onDelete: "CASCADE",
});
EmergencyAcknowledgement.belongsTo(EmergencyAlert, {
  foreignKey: "emergency_alert_id",
});

User.hasMany(EmergencyAcknowledgement, {
  foreignKey: "user_id",
});
EmergencyAcknowledgement.belongsTo(User, {
  foreignKey: "user_id",
});




User.hasMany(GuardShift, { foreignKey: "guard_id" });
GuardShift.belongsTo(User, { foreignKey: "guard_id" });

Society.hasMany(GuardShift, { foreignKey: "society_id" });
GuardShift.belongsTo(Society, { foreignKey: "society_id" });

Society.hasMany(GuardShiftTiming, { foreignKey: "society_id" });
GuardShiftTiming.belongsTo(Society, { foreignKey: "society_id" });

Society.hasMany(GuardShiftPlace, { foreignKey: "society_id", as: "guardShiftPlaces" });
GuardShiftPlace.belongsTo(Society, { foreignKey: "society_id", as: "society" });
GuardShiftPlace.hasMany(GuardShift, { foreignKey: "shift_place_id", as: "shifts" });
GuardShift.belongsTo(GuardShiftPlace, { foreignKey: "shift_place_id", as: "shiftPlace" });


Society.hasMany(Notification, { foreignKey: "society_id" });
Notification.belongsTo(Society, { foreignKey: "society_id" });

Notification.belongsTo(User, {
  foreignKey: "user_id"
});

User.hasMany(Notification, {
  foreignKey: "user_id"
});

// === MAINTENANCE RATES (society-owned config) ===
Society.hasMany(MaintenanceRate, { foreignKey: "society_id" });
MaintenanceRate.belongsTo(Society, { foreignKey: "society_id" });

// A maintenance rate can produce many maintenance bills.
MaintenanceRate.hasMany(Bill, { foreignKey: "maintenance_rate_id", as: "bills" });
Bill.belongsTo(MaintenanceRate, { foreignKey: "maintenance_rate_id", as: "rate" });

// === MAINTENANCE LATE FEE CONFIG & WAIVER HISTORY ===
Society.hasOne(MaintenanceLateFeeConfig, { foreignKey: "society_id", as: "lateFeeConfig" });
MaintenanceLateFeeConfig.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Bill.hasMany(BillLateFeeWaiver, { foreignKey: "bill_id", as: "lateFeeWaivers" });
BillLateFeeWaiver.belongsTo(Bill, { foreignKey: "bill_id", as: "bill" });
BillLateFeeWaiver.belongsTo(User, { foreignKey: "waived_by", as: "waivedByUser" });

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

Society.hasMany(Parcel, { foreignKey: "society_id" });
Parcel.belongsTo(Society, { foreignKey: "society_id" });

/* ── Parcel accountability associations (additive) ──
   guard_id stays exactly as it was (legacy single-guard column). The new
   columns keep the two real gate events apart: who received the parcel and
   who handed it over. Nothing here back-fills existing rows. */
Parcel.belongsTo(User, { foreignKey: "requested_by", as: "requester" });
Parcel.belongsTo(User, { foreignKey: "arrival_guard_id", as: "arrivalGuard" });
Parcel.belongsTo(User, { foreignKey: "delivery_guard_id", as: "deliveryGuard" });

User.hasMany(Parcel, { foreignKey: "requested_by", as: "requestedParcels" });
User.hasMany(Parcel, { foreignKey: "arrival_guard_id", as: "arrivalParcels" });
User.hasMany(Parcel, { foreignKey: "delivery_guard_id", as: "deliveryParcels" });

// Legacy single-guard reference, exposed read-only for the admin views.
Parcel.belongsTo(User, { foreignKey: "guard_id", as: "legacyGuard" });
User.hasMany(Parcel, { foreignKey: "guard_id", as: "legacyParcels" });

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
   CLEANING STAFF ASSOCIATIONS
   Cleaning staff are society-owned operational records, not app users, so they
   live in their own tables and never join the User associations above. Every
   child row also carries society_id so a read can be scoped without a join.
==== */

// Society → CleaningStaff
Society.hasMany(CleaningStaff, { foreignKey: "society_id", as: "cleaningStaff" });
CleaningStaff.belongsTo(Society, { foreignKey: "society_id" });

// CleaningStaff → passes / attendance
CleaningStaff.hasMany(CleaningStaffPass, {
  foreignKey: "cleaning_staff_id",
  as: "passes",
  onDelete: "CASCADE",
});
CleaningStaffPass.belongsTo(CleaningStaff, {
  foreignKey: "cleaning_staff_id",
  as: "cleaningStaff",
});

CleaningStaff.hasMany(CleaningStaffAttendance, {
  foreignKey: "cleaning_staff_id",
  as: "attendance",
  onDelete: "CASCADE",
});
CleaningStaffAttendance.belongsTo(CleaningStaff, {
  foreignKey: "cleaning_staff_id",
  as: "cleaningStaff",
});

// Attendance → the pass that opened it, for audit
CleaningStaffPass.hasMany(CleaningStaffAttendance, {
  foreignKey: "pass_id",
  as: "attendance",
});
CleaningStaffAttendance.belongsTo(CleaningStaffPass, {
  foreignKey: "pass_id",
  as: "pass",
});

/* ====
   GUARD ATTENDANCE ASSOCIATIONS
==== */

// GuardAttendance → Guard (User)
GuardAttendance.belongsTo(User, { foreignKey: "guard_id", as: "guard" });
User.hasMany(GuardAttendance, { foreignKey: "guard_id", as: "guardAttendances" });

// GuardAttendance → GuardShift
GuardAttendance.belongsTo(GuardShift, { foreignKey: "shift_id", as: "shift" });
GuardShift.hasMany(GuardAttendance, { foreignKey: "shift_id", as: "attendances" });

// GuardAttendance → Society
GuardAttendance.belongsTo(Society, { foreignKey: "society_id", as: "society" });
Society.hasMany(GuardAttendance, { foreignKey: "society_id", as: "guardAttendances" });

// GuardAttendance → Admin who manually edited
GuardAttendance.belongsTo(User, { foreignKey: "manually_edited_by", as: "manualEditor" });

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
User.hasMany(Document, { foreignKey: "uploaded_by", as: "uploadedDocs" });

Document.belongsTo(Society, { foreignKey: "society_id" });
Society.hasMany(Document, { foreignKey: "society_id" });

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

// AccountantAssignment Associations
User.hasMany(AccountantAssignment, { foreignKey: "user_id", as: "accountantAssignments" });
AccountantAssignment.belongsTo(User, { foreignKey: "user_id", as: "user" });

Society.hasMany(AccountantAssignment, { foreignKey: "society_id", as: "accountantAssignments" });
AccountantAssignment.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Society.hasMany(RolePermission, { foreignKey: "society_id", as: "rolePermissions" });
RolePermission.belongsTo(Society, { foreignKey: "society_id", as: "society" });

/* ====
   FINANCIAL MODULE ASSOCIATIONS
==== */
// Payment -> Society / Resident / AmenityBooking
Payment.belongsTo(Society, { foreignKey: "society_id", as: "society" });
Payment.belongsTo(require("./User"), { foreignKey: "resident_id", as: "resident" });
AmenityBooking.hasOne(Payment, { foreignKey: "amenity_booking_id", as: "payment" });
Payment.belongsTo(AmenityBooking, { foreignKey: "amenity_booking_id", as: "booking" });

// Society -> Expense / LedgerEntry / FinancialAuditLog
Society.hasMany(Expense, { foreignKey: "society_id", as: "expenses" });
Expense.belongsTo(Society, { foreignKey: "society_id", as: "society" });
Society.hasMany(LedgerEntry, { foreignKey: "society_id", as: "ledgerEntries" });
LedgerEntry.belongsTo(Society, { foreignKey: "society_id", as: "society" });
Society.hasMany(FinancialAuditLog, { foreignKey: "society_id", as: "auditLogs" });
FinancialAuditLog.belongsTo(Society, { foreignKey: "society_id", as: "society" });

// Financial Accounts, Expense Categories & Fixed Deposits
Society.hasMany(SocietyFinancialAccount, { foreignKey: "society_id", as: "financialAccounts" });
SocietyFinancialAccount.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Society.hasMany(ExpenseCategory, { foreignKey: "society_id", as: "expenseCategories" });
ExpenseCategory.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Society.hasMany(FixedDeposit, { foreignKey: "society_id", as: "fixedDeposits" });
FixedDeposit.belongsTo(Society, { foreignKey: "society_id", as: "society" });

FixedDeposit.belongsTo(SocietyFinancialAccount, { foreignKey: "funding_account_id", as: "fundingAccount" });
FixedDeposit.belongsTo(SocietyFinancialAccount, { foreignKey: "receiving_account_id", as: "receivingAccount" });

FixedDeposit.hasMany(FixedDepositTransaction, { foreignKey: "fixed_deposit_id", as: "transactions" });
FixedDepositTransaction.belongsTo(FixedDeposit, { foreignKey: "fixed_deposit_id", as: "fixedDeposit" });
FixedDepositTransaction.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });
FixedDepositTransaction.hasMany(LedgerEntry, { foreignKey: "fd_transaction_id", as: "ledgerEntries" });
LedgerEntry.belongsTo(FixedDepositTransaction, { foreignKey: "fd_transaction_id", as: "fdTransaction" });

SocietyFinancialAccount.hasMany(Expense, { foreignKey: "financial_account_id", as: "expenses" });
Expense.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

ExpenseCategory.hasMany(Expense, { foreignKey: "expense_category_id", as: "expenses" });
Expense.belongsTo(ExpenseCategory, { foreignKey: "expense_category_id", as: "category" });

SocietyFinancialAccount.hasMany(LedgerEntry, { foreignKey: "financial_account_id", as: "ledgerEntries" });
LedgerEntry.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

SocietyFinancialAccount.hasMany(Payment, { foreignKey: "financial_account_id", as: "payments" });
Payment.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

SocietyFinancialAccount.hasMany(MaintenanceRate, { foreignKey: "financial_account_id", as: "maintenanceRates" });
MaintenanceRate.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

SocietyFinancialAccount.hasMany(Bill, { foreignKey: "financial_account_id", as: "bills" });
Bill.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

SocietyFinancialAccount.hasMany(AmenityBooking, { foreignKey: "financial_account_id", as: "amenityBookings" });
AmenityBooking.belongsTo(SocietyFinancialAccount, { foreignKey: "financial_account_id", as: "financialAccount" });

/* ==== EVENT MANAGEMENT ASSOCIATIONS ==== */
Society.hasMany(Event, { foreignKey: "society_id", as: "events" });
Event.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Event.hasMany(EventMedia, { foreignKey: "event_id", as: "media", onDelete: "CASCADE" });
EventMedia.belongsTo(Event, { foreignKey: "event_id", as: "event" });

Event.belongsTo(User, { foreignKey: "created_by_user_id", as: "creator" });
User.hasMany(Event, { foreignKey: "created_by_user_id", as: "createdEvents" });

// Rules & Regulations Associations
Society.hasMany(Rule, { foreignKey: "society_id", as: "rules" });
Rule.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Rule.hasMany(RuleVersion, { foreignKey: "rule_id", as: "versions" });
RuleVersion.belongsTo(Rule, { foreignKey: "rule_id", as: "rule" });

RuleVersion.belongsTo(Society, { foreignKey: "society_id", as: "society" });
RuleVersion.belongsTo(User, { foreignKey: "published_by_user_id", as: "publisher" });

Rule.hasMany(RuleAcknowledgement, { foreignKey: "rule_id", as: "acknowledgements" });
RuleAcknowledgement.belongsTo(Rule, { foreignKey: "rule_id", as: "rule" });

RuleVersion.hasMany(RuleAcknowledgement, { foreignKey: "rule_version_id", as: "acknowledgements" });
RuleAcknowledgement.belongsTo(RuleVersion, { foreignKey: "rule_version_id", as: "version" });

User.hasMany(RuleAcknowledgement, { foreignKey: "user_id", as: "rule_acknowledgements" });
RuleAcknowledgement.belongsTo(User, { foreignKey: "user_id", as: "user" });

Society.hasMany(RuleAcknowledgement, { foreignKey: "society_id", as: "rule_acknowledgements" });
RuleAcknowledgement.belongsTo(Society, { foreignKey: "society_id", as: "society" });

// Amenity Rules & Terms Associations
Society.hasMany(AmenityRule, { foreignKey: "society_id", as: "amenityRules" });
AmenityRule.belongsTo(Society, { foreignKey: "society_id", as: "society" });

AmenityRule.belongsTo(User, { foreignKey: "created_by_user_id", as: "creator" });
User.hasMany(AmenityRule, { foreignKey: "created_by_user_id", as: "createdAmenityRules" });

AmenityRule.hasMany(AmenityRuleAttachment, { foreignKey: "rule_id", as: "attachments" });
AmenityRuleAttachment.belongsTo(AmenityRule, { foreignKey: "rule_id", as: "rule" });

AmenityBooking.hasOne(AmenityBookingTermsAcceptance, { foreignKey: "booking_id", as: "termsAcceptance" });
AmenityBookingTermsAcceptance.belongsTo(AmenityBooking, { foreignKey: "booking_id", as: "booking" });

AmenityBookingTermsAcceptance.belongsTo(Amenity, { foreignKey: "amenity_id", as: "amenity" });
AmenityBookingTermsAcceptance.belongsTo(User, { foreignKey: "user_id", as: "user" });
AmenityBookingTermsAcceptance.belongsTo(Society, { foreignKey: "society_id", as: "society" });

// Meeting Minutes (MOM) Associations
Society.hasMany(MeetingCategory, { foreignKey: "society_id", as: "meetingCategories" });
MeetingCategory.belongsTo(Society, { foreignKey: "society_id", as: "society" });

Society.hasMany(MeetingMinutes, { foreignKey: "society_id", as: "meetingMinutes" });
MeetingMinutes.belongsTo(Society, { foreignKey: "society_id", as: "society" });

MeetingCategory.hasMany(MeetingMinutes, { foreignKey: "category_id", as: "meetings" });
MeetingMinutes.belongsTo(MeetingCategory, { foreignKey: "category_id", as: "category" });

MeetingMinutes.belongsTo(User, { foreignKey: "created_by", as: "creator" });
MeetingMinutes.belongsTo(User, { foreignKey: "updated_by", as: "updater" });

MeetingMinutes.hasMany(MeetingAttendee, { foreignKey: "meeting_id", as: "attendees" });
MeetingAttendee.belongsTo(MeetingMinutes, { foreignKey: "meeting_id", as: "meeting" });

User.hasMany(MeetingAttendee, { foreignKey: "user_id", as: "meetingAttendances" });
MeetingAttendee.belongsTo(User, { foreignKey: "user_id", as: "user" });

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
  GuardShiftTiming,
  GuardShiftPlace,
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
  MaintenanceRate,
  MaintenanceLateFeeConfig,
  BillLateFeeWaiver,
  AccountantAssignment,
  RolePermission,
  EmergencyAcknowledgement,
  Expense,
  LedgerEntry,
  FinancialAuditLog,
  SocietyFinancialAccount,
  ExpenseCategory,
  FixedDeposit,
  FixedDepositTransaction,
  CleaningStaff,
  CleaningStaffPass,
  CleaningStaffAttendance,
  GuardAttendance,
  Event,
  EventMedia,
  UserSociety,
  UserSocietyRole,
  SocietyInvite,
  Rule,
  RuleVersion,
  RuleAcknowledgement,
  AmenityRule,
  AmenityRuleAttachment,
  AmenityBookingTermsAcceptance,
  MeetingCategory,
  MeetingMinutes,
  MeetingAttendee,
};
