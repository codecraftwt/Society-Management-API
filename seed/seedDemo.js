require("dotenv").config();
const bcrypt = require("bcryptjs");
const sequelize = require("../config/db");

const Society = require("../models/Society");
const Block = require("../models/Block");
const Floor = require("../models/Floor");
const Flat = require("../models/Flat");
const User = require("../models/User");
const FlatMembership = require("../models/FlatMembership");
const FlatOwnership = require("../models/FlatOwnership");
const HouseHoldMember = require("../models/HouseHoldMember");
const Bill = require("../models/Bill");
const BillingRule = require("../models/BillingRule");
const Payment = require("../models/Payment");
const Notice = require("../models/Notice");
const Complaint = require("../models/Complaint");
const ComplaintComment = require("../models/ComplaintComment");
const ComplaintReadStatus = require("../models/ComplaintReadStatus");
const VisitorLog = require("../models/VisitorLog");
const VisitorPreApproval = require("../models/VisitorPreApproval");
const GuardShift = require("../models/GuardShift");
const GuardLog = require("../models/GuardLog");
const EmergencyAlert = require("../models/EmergencyAlert");
const Notification = require("../models/Notification");
const Vehicle = require("../models/Vehicle");
const ParkingSlot = require("../models/ParkingSlot");
const ParkingRequest = require("../models/ParkingRequest");
const Parcel = require("../models/Parcel");
const Amenity = require("../models/Amenity");
const AmenityBooking = require("../models/AmenityBooking");
const Document = require("../models/Document");
const UserDocuments = require("../models/UserDocuments");
const ResidentHistory = require("../models/ResidentHistory");
const MaintenanceRate = require("../models/MaintenanceRate");
const UserSetting = require("../models/UserSetting");
const OtpVerification = require("../models/OtpVerification");

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const addHours = (n) => {
  const d = new Date();
  d.setHours(d.getHours() + n);
  return d;
};

const seed = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    const existing = await User.findOne({ where: { email: "demo1@society.com" } });
    if (existing) {
      console.log("Seed already ran. Skipping.");
      process.exit(0);
    }

    const PASSWORD = await bcrypt.hash("Demo@123", 10);

    /* ════════════════════════════════════════════════
       1. SOCIETIES (5) — one block each
    ════════════════════════════════════════════════ */
    const societyNames = [
      "Sunrise Apartments",
      "Moonlight Residency",
      "Green Valley Homes",
      "Skyline Towers",
      "Royal Enclave",
    ];
    const societies = [];
    for (const name of societyNames) {
      societies.push(await Society.create({ name, address: `${name} Main Road, Pune 411001` }));
    }

    /* ════════════════════════════════════════════════
       2. BLOCKS (5) — 1 block per society
    ════════════════════════════════════════════════ */
    const blockDefs = [
      { name: "A-Wing", society_idx: 0, property_type: "Apartments" },
      { name: "B-Wing", society_idx: 1, property_type: "Apartments" },
      { name: "C-Wing", society_idx: 2, property_type: "RowHouse" },
      { name: "D-Wing", society_idx: 3, property_type: "Apartments" },
      { name: "E-Wing", society_idx: 4, property_type: "RowHouse" },
    ];
    const blocks = [];
    for (const bd of blockDefs) {
      blocks.push(await Block.create({ name: bd.name, society_id: societies[bd.society_idx].id, property_type: bd.property_type }));
    }

    /* ════════════════════════════════════════════════
       3. FLOORS (5) — 1 floor per block
    ════════════════════════════════════════════════ */
    const floors = [];
    for (let i = 0; i < 5; i++) {
      floors.push(await Floor.create({ floor_number: String(i + 1), block_id: blocks[i].id }));
    }

    /* ════════════════════════════════════════════════
       4. FLATS (5) — 1 flat per block, one in each society
    ════════════════════════════════════════════════ */
    const flatDefs = [
      { flat_number: "A-101", block_idx: 0, floor_idx: 0, flat_type: "2BHK", occupancy_status: "OWNER_OCCUPIED" },
      { flat_number: "B-101", block_idx: 1, floor_idx: 1, flat_type: "1BHK", occupancy_status: "OWNER_OCCUPIED" },
      { flat_number: "C-1", block_idx: 2, floor_idx: 2, flat_type: "3BHK", occupancy_status: "OWNER_OCCUPIED" },
      { flat_number: "D-101", block_idx: 3, floor_idx: 3, flat_type: "2BHK", occupancy_status: "VACANT" },
      { flat_number: "E-1", block_idx: 4, floor_idx: 4, flat_type: "3BHK", occupancy_status: "VACANT" },
    ];
    const flats = [];
    for (const fd of flatDefs) {
      flats.push(await Flat.create({
        flat_number: fd.flat_number,
        block_id: blocks[fd.block_idx].id,
        floor_id: floors[fd.floor_idx].id,
        flat_type: fd.flat_type,
        occupancy_status: fd.occupancy_status,
        resident_id: null,
      }));
    }
    const [flat1, flat2, flat3, flat4, flat5] = flats;

    /* ════════════════════════════════════════════════
       5. USERS (5) — spread across societies
    ════════════════════════════════════════════════ */
    const userDefs = [
      { name: "Ravi Verma", email: "demo1@society.com", phone: "9000000001", role: "SOCIETY_ADMIN", roles: ["SOCIETY_ADMIN", "RESIDENT"], resident_type: "OWNER", society_idx: 0 },
      { name: "Amit Sharma", email: "demo2@society.com", phone: "9000000002", role: "RESIDENT", roles: ["RESIDENT"], resident_type: "OWNER", society_idx: 1 },
      { name: "Sneha Patil", email: "demo3@society.com", phone: "9000000003", role: "RESIDENT", roles: ["RESIDENT"], resident_type: "OWNER", society_idx: 2 },
      { name: "Suresh Yadav", email: "demo4@society.com", phone: "9000000004", role: "GUARD", roles: ["GUARD"], resident_type: null, society_idx: 0 },
      { name: "Manoj Tiwari", email: "demo5@society.com", phone: "9000000005", role: "GUARD", roles: ["GUARD"], resident_type: null, society_idx: 1 },
    ];
    const users = [];
    for (const ud of userDefs) {
      users.push(await User.create({
        name: ud.name,
        email: ud.email,
        phone: ud.phone,
        password: PASSWORD,
        role: ud.role,
        roles: ud.roles,
        society_id: societies[ud.society_idx].id,
        approval_status: "APPROVED",
        status: "ACTIVE",
        resident_type: ud.resident_type,
      }));
    }
    const [admin, res1, res2, guard1, guard2] = users;

    /* assign residents to their flats */
    await Flat.update({ resident_id: admin.id }, { where: { id: flat1.id } });
    await Flat.update({ resident_id: res1.id }, { where: { id: flat2.id } });
    await Flat.update({ resident_id: res2.id }, { where: { id: flat3.id } });

    /* ════════════════════════════════════════════════
       6. FLAT MEMBERSHIPS (5)
    ════════════════════════════════════════════════ */
    const membershipDefs = [
      { flat_id: flat1.id, user_id: admin.id, role: "OWNER" },
      { flat_id: flat2.id, user_id: res1.id, role: "OWNER" },
      { flat_id: flat3.id, user_id: res2.id, role: "OWNER" },
      { flat_id: flat4.id, user_id: admin.id, role: "OWNER" },
      { flat_id: flat5.id, user_id: res1.id, role: "TENANT" },
    ];
    for (const md of membershipDefs) {
      await FlatMembership.create({
        flat_id: md.flat_id,
        user_id: md.user_id,
        role: md.role,
        is_staying: true,
        pays_maintenance: true,
        move_in_date: daysFromNow(-180),
        move_out_date: null,
        is_current: true,
      });
    }

    /* ════════════════════════════════════════════════
       7. FLAT OWNERSHIPS (5) — one per flat, all is_current: true
    ════════════════════════════════════════════════ */
    const ownershipDefs = [
      { user_id: admin.id, flat_id: flat1.id, resident_type: "OWNER", flat_type: "2BHK", is_primary: true },
      { user_id: res1.id, flat_id: flat2.id, resident_type: "OWNER", flat_type: "1BHK", is_primary: true },
      { user_id: res2.id, flat_id: flat3.id, resident_type: "OWNER", flat_type: "3BHK", is_primary: true },
      { user_id: admin.id, flat_id: flat4.id, resident_type: "OWNER", flat_type: "2BHK", is_primary: false },
      { user_id: res1.id, flat_id: flat5.id, resident_type: "TENANT", flat_type: "3BHK", is_primary: false },
    ];
    for (const od of ownershipDefs) {
      await FlatOwnership.create({
        user_id: od.user_id,
        flat_id: od.flat_id,
        resident_type: od.resident_type,
        flat_type: od.flat_type,
        is_primary: od.is_primary,
        is_current: true,
        move_in_date: addHours(-180 * 24),
      });
    }

    /* ════════════════════════════════════════════════
       8. RESIDENT HISTORY (5)
    ════════════════════════════════════════════════ */
    const historyDefs = [
      { flat_id: flat1.id, user_id: admin.id },
      { flat_id: flat2.id, user_id: res1.id },
      { flat_id: flat3.id, user_id: res2.id },
      { flat_id: flat4.id, user_id: admin.id },
      { flat_id: flat5.id, user_id: res1.id },
    ];
    for (const hd of historyDefs) {
      await ResidentHistory.create({
        flat_id: hd.flat_id,
        user_id: hd.user_id,
        move_in_date: addHours(-180 * 24),
        move_out_date: null,
        is_current: true,
      });
    }

    /* ════════════════════════════════════════════════
       9. HOUSEHOLD MEMBERS (5)
    ════════════════════════════════════════════════ */
    const hhDefs = [
      { name: "Priya Verma", relation: "Wife", phone: "9001000001", flat_id: flat1.id, user_id: admin.id, isAdmin: true },
      { name: "Rohit Verma", relation: "Son", phone: "9001000002", flat_id: flat1.id, user_id: admin.id, isAdmin: false },
      { name: "Kavita Sharma", relation: "Wife", phone: "9001000003", flat_id: flat2.id, user_id: res1.id, isAdmin: true },
      { name: "Rahul Patil", relation: "Brother", phone: "9001000004", flat_id: flat3.id, user_id: res2.id, isAdmin: false },
      { name: "Sunita Sharma", relation: "Wife", phone: "9001000005", flat_id: flat4.id, user_id: admin.id, isAdmin: true },
    ];
    for (const hh of hhDefs) {
      await HouseHoldMember.create(hh);
    }

    /* ════════════════════════════════════════════════
       10. BILLING RULES (5) — one per society
    ════════════════════════════════════════════════ */
    const brDefs = [
      { name: "Monthly Maintenance", amount: 3000, frequency: "MONTHLY", description: "Regular monthly maintenance charge", society_idx: 0 },
      { name: "Water Charges", amount: 500, frequency: "MONTHLY", description: "Monthly water supply charge", society_idx: 1 },
      { name: "Parking Fee", amount: 1000, frequency: "MONTHLY", description: "Covered parking slot rent", society_idx: 2 },
      { name: "Security Deposit", amount: 10000, frequency: "ONE_TIME", description: "One-time refundable security deposit", society_idx: 3 },
      { name: "Annual Insurance", amount: 2000, frequency: "YEARLY", description: "Annual society building insurance", society_idx: 4 },
    ];
    for (const br of brDefs) {
      await BillingRule.create({ name: br.name, amount: br.amount, frequency: br.frequency, description: br.description, society_id: societies[br.society_idx].id });
    }

    /* ════════════════════════════════════════════════
       11. BILLS (5) — one per flat
    ════════════════════════════════════════════════ */
    const billDefs = [
      { flat_id: flat1.id, title: "Maintenance Jul 2026", amount: 3000, billing_month: "July 2026", status: "PENDING" },
      { flat_id: flat2.id, title: "Maintenance Jul 2026", amount: 2500, billing_month: "July 2026", status: "PAID" },
      { flat_id: flat3.id, title: "Maintenance Jul 2026", amount: 4500, billing_month: "July 2026", status: "PENDING" },
      { flat_id: flat4.id, title: "Maintenance Jul 2026", amount: 3000, billing_month: "July 2026", status: "PAID" },
      { flat_id: flat5.id, title: "Maintenance Jul 2026", amount: 3500, billing_month: "July 2026", status: "PENDING" },
    ];
    const bills = [];
    for (const bd of billDefs) {
      bills.push(await Bill.create({ ...bd, due_date: new Date(daysFromNow(15)) }));
    }

    /* ════════════════════════════════════════════════
       12. PAYMENTS (5) — one per bill (all paid)
    ════════════════════════════════════════════════ */
    const payDefs = [
      { bill_id: bills[1].id, amount: 2500, payment_mode: "UPI", payment_date: addHours(-10) },
      { bill_id: bills[3].id, amount: 3000, payment_mode: "Card", payment_date: addHours(-30) },
      { bill_id: bills[0].id, amount: 1500, payment_mode: "UPI", payment_date: addHours(-5) },
      { bill_id: bills[2].id, amount: 2000, payment_mode: "Cash", payment_date: addHours(-2) },
      { bill_id: bills[4].id, amount: 3500, payment_mode: "NetBanking", payment_date: addHours(-8) },
    ];
    for (const pd of payDefs) {
      await Payment.create(pd);
    }

    /* ════════════════════════════════════════════════
       13. NOTICES (5) — one per society
    ════════════════════════════════════════════════ */
    const noticeDefs = [
      { title: "Annual General Meeting", description: "AGM will be held in the clubhouse on the last Sunday at 11 AM.", society_idx: 0 },
      { title: "Water Tank Cleaning", description: "Water supply will be interrupted on Saturday 10 AM - 2 PM.", society_idx: 1 },
      { title: "Diwali Celebration", description: "Join us for the society Diwali celebration on November 3rd.", society_idx: 2 },
      { title: "Solar Panel Installation", description: "Solar panels will be installed on rooftops next week.", society_idx: 3 },
      { title: "New Parking Rules", description: "Effective next month, visitor parking requires prior approval.", society_idx: 4 },
    ];
    for (const nd of noticeDefs) {
      await Notice.create({ society_id: societies[nd.society_idx].id, title: nd.title, description: nd.description, file_url: null });
    }

    /* ════════════════════════════════════════════════
       14. COMPLAINTS (5) — spread across societies
    ════════════════════════════════════════════════ */
    const complaintDefs = [
      { resident_id: admin.id, flat_id: flat1.id, society_idx: 0, title: "Water leakage in bathroom", description: "Persistent leak from the ceiling.", status: "OPEN" },
      { resident_id: res1.id, flat_id: flat2.id, society_idx: 1, title: "Lift not working", description: "Lift B out of service since morning.", status: "IN_PROGRESS" },
      { resident_id: res2.id, flat_id: flat3.id, society_idx: 2, title: "Garbage not collected", description: "Floor 3 corridor garbage pending for 2 days.", status: "RESOLVED" },
      { resident_id: admin.id, flat_id: flat4.id, society_idx: 3, title: "Street light flickering", description: "Street lamp near D-Wing flickers at night.", status: "OPEN" },
      { resident_id: res1.id, flat_id: flat5.id, society_idx: 4, title: "Parking dispute", description: "Unknown car parked in my assigned slot.", status: "IN_PROGRESS" },
    ];
    const complaints = [];
    for (const cd of complaintDefs) {
      complaints.push(await Complaint.create({
        resident_id: cd.resident_id,
        flat_id: cd.flat_id,
        society_id: societies[cd.society_idx].id,
        title: cd.title,
        description: cd.description,
        status: cd.status,
        photo_url: null,
        photo_public_id: null,
      }));
    }

    /* ════════════════════════════════════════════════
       15. COMPLAINT COMMENTS (5)
    ════════════════════════════════════════════════ */
    const ccDefs = [
      { complaint_id: complaints[0].id, user_id: admin.id, message: "We have registered your complaint." },
      { complaint_id: complaints[1].id, user_id: admin.id, message: "Technician has been called." },
      { complaint_id: complaints[2].id, user_id: res2.id, message: "Issue resolved. Thank you." },
      { complaint_id: complaints[3].id, user_id: admin.id, message: "Will get it replaced this week." },
      { complaint_id: complaints[4].id, user_id: res1.id, message: "Please look into this urgently." },
    ];
    for (const ccd of ccDefs) {
      await ComplaintComment.create({ ...ccd, attachment_url: null, attachment_type: null, attachment_name: null });
    }

    /* ════════════════════════════════════════════════
       16. COMPLAINT READ STATUS (5)
    ════════════════════════════════════════════════ */
    const crsDefs = [
      { complaint_id: complaints[0].id, user_id: admin.id, last_read_at: addHours(-1) },
      { complaint_id: complaints[1].id, user_id: res1.id, last_read_at: addHours(-2) },
      { complaint_id: complaints[2].id, user_id: res2.id, last_read_at: addHours(-3) },
      { complaint_id: complaints[3].id, user_id: admin.id, last_read_at: addHours(-4) },
      { complaint_id: complaints[4].id, user_id: res1.id, last_read_at: addHours(-5) },
    ];
    for (const crd of crsDefs) {
      await ComplaintReadStatus.create(crd);
    }

    /* ════════════════════════════════════════════════
       17. VISITOR LOGS (5) — across different societies
    ════════════════════════════════════════════════ */
    const visitorDefs = [
      { visitor_name: "Ravi Kumar", mobile: "9820000001", purpose: "GUEST", flat_id: flat1.id, guard_id: guard1.id, society_idx: 0, vehicle_number: "MH12AB1234", exit: true },
      { visitor_name: "Amazon Delivery", mobile: "9820000002", purpose: "DELIVERY", flat_id: flat2.id, guard_id: guard2.id, society_idx: 1, vehicle_number: null, exit: true },
      { visitor_name: "Electrician", mobile: "9820000003", purpose: "MAINTENANCE", flat_id: flat3.id, guard_id: guard1.id, society_idx: 2, vehicle_number: "MH12CD5678", exit: true },
      { visitor_name: "Uber Cab", mobile: "9820000004", purpose: "CAB", flat_id: flat4.id, guard_id: guard2.id, society_idx: 3, vehicle_number: "MH12EF9012", exit: false },
      { visitor_name: "Plumber", mobile: "9820000005", purpose: "SERVICE", flat_id: flat5.id, guard_id: guard1.id, society_idx: 4, vehicle_number: null, exit: false },
    ];
    for (const vd of visitorDefs) {
      await VisitorLog.create({
        visitor_name: vd.visitor_name,
        mobile: vd.mobile,
        vehicle_number: vd.vehicle_number,
        purpose: vd.purpose,
        flat_id: vd.flat_id,
        guard_id: vd.guard_id,
        society_id: societies[vd.society_idx].id,
        entry_time: addHours(-4),
        exit_time: vd.exit ? addHours(-2) : null,
      });
    }

    /* ════════════════════════════════════════════════
       18. VISITOR PRE-APPROVALS (5)
    ════════════════════════════════════════════════ */
    const preApprovalDefs = [
      { resident_id: admin.id, flat_id: flat1.id, society_idx: 0, visitor_name: "Ravi Kumar", mobile: "9820000001", vehicle_number: "MH12AB1234", purpose: "Family visit", otp: "1111", status: "USED" },
      { resident_id: res1.id, flat_id: flat2.id, society_idx: 1, visitor_name: "Sandeep Rao", mobile: "9820000006", vehicle_number: "MH12GH3456", purpose: "Guest visit", otp: "2222", status: "PENDING" },
      { resident_id: res2.id, flat_id: flat3.id, society_idx: 2, visitor_name: "Courier Boy", mobile: "9820000007", vehicle_number: null, purpose: "Package delivery", otp: "3333", status: "PENDING" },
      { resident_id: admin.id, flat_id: flat4.id, society_idx: 3, visitor_name: "Carpenter", mobile: "9820000008", vehicle_number: null, purpose: "Furniture repair", otp: "4444", status: "EXPIRED" },
      { resident_id: res1.id, flat_id: flat5.id, society_idx: 4, visitor_name: "Cousin", mobile: "9820000009", vehicle_number: "MH12IJ7890", purpose: "Weekend stay", otp: "5555", status: "PENDING" },
    ];
    for (const pa of preApprovalDefs) {
      await VisitorPreApproval.create({
        ...pa,
        society_id: societies[pa.society_idx].id,
        valid_date: daysFromNow(2),
      });
    }

    /* ════════════════════════════════════════════════
       19. GUARD SHIFTS (5)
    ════════════════════════════════════════════════ */
    const shiftDefs = [
      { guard_id: guard1.id, society_idx: 0, shift_type: "MORNING", start_date: daysFromNow(-7), end_date: daysFromNow(30) },
      { guard_id: guard1.id, society_idx: 0, shift_type: "NIGHT", start_date: daysFromNow(1), end_date: daysFromNow(37) },
      { guard_id: guard2.id, society_idx: 1, shift_type: "AFTERNOON", start_date: daysFromNow(-7), end_date: daysFromNow(30) },
      { guard_id: guard2.id, society_idx: 1, shift_type: "MORNING", start_date: daysFromNow(1), end_date: daysFromNow(37) },
      { guard_id: guard1.id, society_idx: 0, shift_type: "AFTERNOON", start_date: daysFromNow(-7), end_date: daysFromNow(30) },
    ];
    for (const sd of shiftDefs) {
      await GuardShift.create({ guard_id: sd.guard_id, society_id: societies[sd.society_idx].id, shift_type: sd.shift_type, start_date: sd.start_date, end_date: sd.end_date });
    }

    /* ════════════════════════════════════════════════
       20. GUARD LOGS (5)
    ════════════════════════════════════════════════ */
    const logDefs = [
      { text: "Night round completed at 2 AM. All gates secure.", is_important: false, guard_id: guard1.id, society_idx: 0 },
      { text: "Found a lost key near the main gate.", is_important: true, guard_id: guard2.id, society_idx: 1 },
      { text: "Fire alarm drill scheduled for Friday.", is_important: false, guard_id: guard1.id, society_idx: 0 },
      { text: "Suspicious vehicle spotted near Block B.", is_important: true, guard_id: guard2.id, society_idx: 1 },
      { text: "Delivered courier packages to 3 flats.", is_important: false, guard_id: guard1.id, society_idx: 0 },
    ];
    for (const ld of logDefs) {
      await GuardLog.create({ text: ld.text, is_important: ld.is_important, guard_id: ld.guard_id, society_id: societies[ld.society_idx].id });
    }

    /* ════════════════════════════════════════════════
       21. EMERGENCY ALERTS (5)
    ════════════════════════════════════════════════ */
    const alertDefs = [
      { message: "Medical emergency at Block A", type: "MEDICAL", source: "RESIDENT", resident_id: admin.id, flat_id: flat1.id, guard_id: guard1.id, society_idx: 0, status: "RESOLVED", resolved_at: addHours(-47) },
      { message: "Water heater smoke in Block B", type: "FIRE", source: "GUARD", resident_id: null, flat_id: flat2.id, guard_id: guard2.id, society_idx: 1, status: "ACTIVE", resolved_at: null },
      { message: "Gas leak smell reported", type: "FIRE", source: "RESIDENT", resident_id: res2.id, flat_id: flat3.id, guard_id: guard1.id, society_idx: 2, status: "RESOLVED", resolved_at: addHours(-10) },
      { message: "Intruder alert at main gate", type: "SECURITY", source: "GUARD", resident_id: null, flat_id: null, guard_id: guard2.id, society_idx: 3, status: "ACTIVE", resolved_at: null },
      { message: "Elevator stuck with passengers", type: "OTHER", source: "RESIDENT", resident_id: res1.id, flat_id: flat5.id, guard_id: guard1.id, society_idx: 4, status: "RESOLVED", resolved_at: addHours(-5) },
    ];
    for (const ad of alertDefs) {
      await EmergencyAlert.create({
        message: ad.message, type: ad.type, source: ad.source,
        resident_id: ad.resident_id, flat_id: ad.flat_id, guard_id: ad.guard_id,
        society_id: societies[ad.society_idx].id,
        status: ad.status, created_at: addHours(-48), resolved_at: ad.resolved_at,
      });
    }

    /* ════════════════════════════════════════════════
       22. PARKING SLOTS (5) — one per flat
    ════════════════════════════════════════════════ */
    const slotDefs = [
      { parking_floor: "Basement 1", slot_number: "A-01", flat_id: flat1.id, resident_id: admin.id, vehicle_type: "CAR", status: "ASSIGNED", parking_type: "DEFAULT", society_idx: 0 },
      { parking_floor: "Basement 1", slot_number: "B-01", flat_id: flat2.id, resident_id: res1.id, vehicle_type: "CAR", status: "ASSIGNED", parking_type: "DEFAULT", society_idx: 1 },
      { parking_floor: "Basement 1", slot_number: "C-01", flat_id: flat3.id, resident_id: res2.id, vehicle_type: "CAR", status: "ASSIGNED", parking_type: "DEFAULT", society_idx: 2 },
      { parking_floor: "Basement 2", slot_number: "D-01", flat_id: null, resident_id: null, vehicle_type: "CAR", status: "AVAILABLE", parking_type: "DEFAULT", society_idx: 3 },
      { parking_floor: "Basement 2", slot_number: "E-01", flat_id: null, resident_id: null, vehicle_type: "BIKE", status: "AVAILABLE", parking_type: "EXTRA", society_idx: 4 },
    ];
    const slots = [];
    for (const sd of slotDefs) {
      slots.push(await ParkingSlot.create({ ...sd, society_id: societies[sd.society_idx].id }));
    }

    /* ════════════════════════════════════════════════
       23. VEHICLES (5)
    ════════════════════════════════════════════════ */
    const vehicleDefs = [
      { vehicle_number: "MH12AB1234", vehicle_type: "CAR", resident_id: admin.id, flat_id: flat1.id, society_idx: 0, vehicle_name: "Hyundai i20", parking_slot_id: slots[0].id },
      { vehicle_number: "MH12CD5678", vehicle_type: "CAR", resident_id: res1.id, flat_id: flat2.id, society_idx: 1, vehicle_name: "Maruti Swift", parking_slot_id: slots[1].id },
      { vehicle_number: "MH12EF9012", vehicle_type: "CAR", resident_id: res2.id, flat_id: flat3.id, society_idx: 2, vehicle_name: "Honda City", parking_slot_id: slots[2].id },
      { vehicle_number: "MH12GH3456", vehicle_type: "BIKE", resident_id: admin.id, flat_id: flat4.id, society_idx: 3, vehicle_name: "Honda Shine", parking_slot_id: null },
      { vehicle_number: "MH12IJ7890", vehicle_type: "BIKE", resident_id: res1.id, flat_id: flat5.id, society_idx: 4, vehicle_name: "Bajaj Pulsar", parking_slot_id: null },
    ];
    const vehicles = [];
    for (const vd of vehicleDefs) {
      vehicles.push(await Vehicle.create({ ...vd, society_id: societies[vd.society_idx].id }));
    }

    /* ════════════════════════════════════════════════
       24. PARKING REQUESTS (5)
    ════════════════════════════════════════════════ */
    const prDefs = [
      { resident_id: admin.id, flat_id: flat1.id, society_idx: 0, guest_name: "Ravi Kumar", vehicle_number: "MH12AB1234", vehicle_type: "CAR", duration_hours: 4, status: "PENDING", assigned_spot: null, parking_type: "VISITOR", vehicle_id: null },
      { resident_id: res1.id, flat_id: flat2.id, society_idx: 1, guest_name: "Sandeep Rao", vehicle_number: "MH12GH3456", vehicle_type: "CAR", duration_hours: 2, status: "APPROVED", assigned_spot: "B-01", parking_type: "VISITOR", vehicle_id: null },
      { resident_id: res2.id, flat_id: flat3.id, society_idx: 2, guest_name: "Rahul Patil", vehicle_number: "MH12IJ7890", vehicle_type: "BIKE", duration_hours: 24, status: "APPROVED", assigned_spot: "C-01", parking_type: "RESIDENT", vehicle_id: vehicles[2].id },
      { resident_id: admin.id, flat_id: flat4.id, society_idx: 3, guest_name: "Amit Verma", vehicle_number: "MH12AB1234", vehicle_type: "CAR", duration_hours: 12, status: "COMPLETED", assigned_spot: "D-01", parking_type: "RESIDENT", vehicle_id: vehicles[0].id },
      { resident_id: res1.id, flat_id: flat5.id, society_idx: 4, guest_name: "Pizza Delivery", vehicle_number: "MH12XX0001", vehicle_type: "BIKE", duration_hours: 1, status: "REJECTED", assigned_spot: null, parking_type: "VISITOR", vehicle_id: null },
    ];
    for (const pd of prDefs) {
      await ParkingRequest.create({ ...pd, society_id: societies[pd.society_idx].id, expected_arrival: addHours(3) });
    }

    /* ════════════════════════════════════════════════
       25. PARCELS (5)
    ════════════════════════════════════════════════ */
    const parcelDefs = [
      { resident_id: admin.id, flat_id: flat1.id, guard_id: guard1.id, society_idx: 0, courier_name: "Amazon", status: "COLLECTED", pickup_code: "1248" },
      { resident_id: res1.id, flat_id: flat2.id, guard_id: guard2.id, society_idx: 1, courier_name: "Flipkart", status: "AT_GATE", pickup_code: "9031" },
      { resident_id: res2.id, flat_id: flat3.id, guard_id: guard1.id, society_idx: 2, courier_name: "BlueDart", status: "AT_GATE", pickup_code: "5512" },
      { resident_id: admin.id, flat_id: flat4.id, guard_id: guard2.id, society_idx: 3, courier_name: "DTDC", status: "EXPECTED", pickup_code: "7788" },
      { resident_id: res1.id, flat_id: flat5.id, guard_id: guard1.id, society_idx: 4, courier_name: "Delhivery", status: "CANCELLED", pickup_code: "3344" },
    ];
    for (const pd of parcelDefs) {
      await Parcel.create({ ...pd, society_id: societies[pd.society_idx].id, entry_time: addHours(-6), image: null });
    }

    /* ════════════════════════════════════════════════
       26. AMENITIES (5) — one per society
    ════════════════════════════════════════════════ */
    const amenityDefs = [
      { name: "Clubhouse", icon: "apartment", type: "PAID", booking_type: "FULL_DAY", rate_per_hour: 500, opening_time: "06:00", closing_time: "22:00", slot_duration: 60, capacity: 50, requires_approval: true, society_idx: 0 },
      { name: "Gymnasium", icon: "fitness", type: "FREE", booking_type: "SLOT", rate_per_hour: 0, opening_time: "05:00", closing_time: "23:00", slot_duration: 60, capacity: 10, requires_approval: false, society_idx: 1 },
      { name: "Swimming Pool", icon: "pool", type: "PAID", booking_type: "SLOT", rate_per_hour: 200, opening_time: "07:00", closing_time: "20:00", slot_duration: 60, capacity: 20, requires_approval: false, society_idx: 2 },
      { name: "Party Hall", icon: "celebration", type: "PAID", booking_type: "FULL_DAY", rate_per_hour: 800, opening_time: "08:00", closing_time: "23:00", slot_duration: 120, capacity: 100, requires_approval: true, society_idx: 3 },
      { name: "Garden Area", icon: "park", type: "FREE", booking_type: "SLOT", rate_per_hour: 0, opening_time: "00:00", closing_time: "23:59", slot_duration: 60, capacity: 30, requires_approval: false, society_idx: 4 },
    ];
    const amenities = [];
    for (const ad of amenityDefs) {
      amenities.push(await Amenity.create({
        name: ad.name, icon: ad.icon, type: ad.type, booking_type: ad.booking_type,
        rate_per_hour: ad.rate_per_hour, opening_time: ad.opening_time, closing_time: ad.closing_time,
        slot_duration: ad.slot_duration, capacity: ad.capacity, requires_approval: ad.requires_approval,
        society_id: societies[ad.society_idx].id, is_active: true,
        disable_type: null, disabled_reason: null, disabled_from: null, disabled_until: null,
      }));
    }

    /* ════════════════════════════════════════════════
       27. AMENITY BOOKINGS (5) — one per amenity
    ════════════════════════════════════════════════ */
    const bookingDefs = [
      { amenity_id: amenities[0].id, user_id: admin.id, flat_id: flat1.id, society_idx: 0, date: daysFromNow(3), start_time: "10:00", end_time: "14:00", status: "APPROVED", payment_status: "PAID" },
      { amenity_id: amenities[1].id, user_id: res1.id, flat_id: flat2.id, society_idx: 1, date: daysFromNow(1), start_time: "06:00", end_time: "07:00", status: "APPROVED", payment_status: "NA" },
      { amenity_id: amenities[2].id, user_id: res2.id, flat_id: flat3.id, society_idx: 2, date: daysFromNow(2), start_time: "08:00", end_time: "09:00", status: "PENDING", payment_status: "PAID" },
      { amenity_id: amenities[3].id, user_id: admin.id, flat_id: flat4.id, society_idx: 3, date: daysFromNow(5), start_time: "18:00", end_time: "22:00", status: "PAYMENT_PENDING", payment_status: "PENDING" },
      { amenity_id: amenities[4].id, user_id: res1.id, flat_id: flat5.id, society_idx: 4, date: daysFromNow(1), start_time: "07:00", end_time: "08:00", status: "APPROVED", payment_status: "NA" },
    ];
    for (const bd of bookingDefs) {
      await AmenityBooking.create({
        ...bd, society_id: societies[bd.society_idx].id,
        razorpay_order_id: null, razorpay_payment_id: null, payment_expires_at: null,
      });
    }

    /* ════════════════════════════════════════════════
       28. DOCUMENTS (5) — one per society
    ════════════════════════════════════════════════ */
    const docDefs = [
      { title: "Society Bye-Laws 2026", description: "Registered bye-laws.", category: "Legal", file_name: "bye-laws.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/bye-laws.pdf", file_size: 245760, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS", society_idx: 0 },
      { title: "AGM Minutes - June 2026", description: "Minutes of the last AGM.", category: "Meetings", file_name: "agm-minutes.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/agm.pdf", file_size: 102400, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS", society_idx: 1 },
      { title: "Visitor Policy", description: "Guidelines for visitor entry.", category: "Guidelines", file_name: "visitor-policy.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/visitor.pdf", file_size: 51200, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS", society_idx: 2 },
      { title: "FY 2025-26 Budget", description: "Annual budget breakdown.", category: "Finance", file_name: "budget.xlsx", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/budget.xlsx", file_size: 40960, mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", visible_to: "ADMIN_ONLY", society_idx: 3 },
      { title: "Security SOP", description: "Guard operating procedures.", category: "Security", file_name: "security-sop.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/security.pdf", file_size: 81920, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS", society_idx: 4 },
    ];
    for (const dd of docDefs) {
      await Document.create({ ...dd, society_id: societies[dd.society_idx].id, uploaded_by: admin.id, is_active: true });
    }

    /* ════════════════════════════════════════════════
       29. USER DOCUMENTS (5)
    ════════════════════════════════════════════════ */
    const aadharUrl = "https://res.cloudinary.com/demo/image/upload/v1/users/aadhar_demo";
    const panUrl = "https://res.cloudinary.com/demo/image/upload/v1/users/pan_demo";
    for (const u of users) {
      await UserDocuments.create({
        user_id: u.id,
        aadhar_url: aadharUrl, aadhar_public_id: "users/aadhar_demo",
        pan_url: panUrl, pan_public_id: "users/pan_demo",
      });
    }

    /* ════════════════════════════════════════════════
       30. MAINTENANCE RATES (5) — one per society
    ════════════════════════════════════════════════ */
    const rateDefs = [
      { flat_type: "1BHK", resident_type: "OWNER", amount: 2500, society_idx: 0 },
      { flat_type: "1BHK", resident_type: "TENANT", amount: 2750, society_idx: 1 },
      { flat_type: "2BHK", resident_type: "OWNER", amount: 3500, society_idx: 2 },
      { flat_type: "2BHK", resident_type: "TENANT", amount: 3800, society_idx: 3 },
      { flat_type: "3BHK", resident_type: "OWNER", amount: 4500, society_idx: 4 },
    ];
    for (const rd of rateDefs) {
      await MaintenanceRate.create({ ...rd, society_id: societies[rd.society_idx].id });
    }

    /* ════════════════════════════════════════════════
       31. NOTIFICATIONS (5) — one per society
    ════════════════════════════════════════════════ */
    const notifDefs = [
      { title: "New maintenance bill", message: "Your July 2026 bill is available.", type: "BILL", user_id: admin.id, receiver_role: "RESIDENT", society_idx: 0, is_read: false },
      { title: "Gate pass request", message: "Ravi Kumar requested entry.", type: "VISITOR", user_id: res1.id, receiver_role: "RESIDENT", society_idx: 1, is_read: true },
      { title: "New complaint", message: "Water leakage complaint raised.", type: "COMPLAINT", user_id: res2.id, receiver_role: "SOCIETY_ADMIN", society_idx: 2, is_read: false },
      { title: "Notice posted", message: "AGM meeting notice published.", type: "NOTICE", user_id: admin.id, receiver_role: "RESIDENT", society_idx: 3, is_read: false },
      { title: "Booking confirmed", message: "Clubhouse booking approved.", type: "AMENITY", user_id: res1.id, receiver_role: "RESIDENT", society_idx: 4, is_read: true },
    ];
    for (const nd of notifDefs) {
      await Notification.create({
        title: nd.title, message: nd.message, type: nd.type,
        user_id: nd.user_id, receiver_role: nd.receiver_role, receiver_user_id: nd.user_id,
        society_id: societies[nd.society_idx].id, is_read: nd.is_read,
        action_type: null, action_route: null,
      });
    }

    /* ════════════════════════════════════════════════
       32. USER SETTINGS (5)
    ════════════════════════════════════════════════ */
    for (const u of users) {
      await UserSetting.create({
        user_id: u.id,
        emergency_alerts: true, visitor_entry: true, complaint_updates: true,
        notice_updates: true, sound_alerts: true, auto_logout: true,
      });
    }

    /* ════════════════════════════════════════════════
       33. OTP VERIFICATIONS (5)
    ════════════════════════════════════════════════ */
    const otpDefs = [
      { email: "demo1@society.com", otp_hash: await bcrypt.hash("111111", 10), attempts: 0, used: true },
      { email: "demo2@society.com", otp_hash: await bcrypt.hash("222222", 10), attempts: 1, used: false },
      { email: "demo3@society.com", otp_hash: await bcrypt.hash("333333", 10), attempts: 0, used: false },
      { email: "demo4@society.com", otp_hash: await bcrypt.hash("444444", 10), attempts: 2, used: true },
      { email: "demo5@society.com", otp_hash: await bcrypt.hash("555555", 10), attempts: 0, used: false },
    ];
    for (const od of otpDefs) {
      const exp = new Date();
      exp.setMinutes(exp.getMinutes() + 2);
      await OtpVerification.create({ ...od, expires_at: exp });
    }

    /* ════════════════════════════════════════════════
       SUMMARY
    ════════════════════════════════════════════════ */
    console.log("Demo data seeded successfully!\n");
    console.log("Total: 33 tables x 5 records = 165 records");
    console.log("Each society has 1 block, 1 floor, 1 flat\n");
    console.log("-- LOGIN CREDENTIALS (password: Demo@123) --");
    console.log("Admin  -> demo1@society.com  (Society: Sunrise Apartments)");
    console.log("Resident 1 -> demo2@society.com  (Society: Moonlight Residency)");
    console.log("Resident 2 -> demo3@society.com  (Society: Green Valley Homes)");
    console.log("Guard 1 -> demo4@society.com  (Society: Sunrise Apartments)");
    console.log("Guard 2 -> demo5@society.com  (Society: Moonlight Residency)");

    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err.message);
    console.error(err);
    process.exit(1);
  }
};

seed();
