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
const Payment = require("../models/Payment");
const Notice = require("../models/Notice");
const Complaint = require("../models/Complaint");
const ComplaintComment = require("../models/ComplaintComment");
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

/* Wipe any previously-seeded demo society (and only its rows) so the script
   is safe to re-run. Uses raw SQL with FK checks off to avoid ordering issues. */
async function cleanupSociety(societyId) {
  const [blockRows] = await sequelize.query(`SELECT id FROM blocks WHERE society_id=${societyId}`);
  const blockIds = blockRows.map((r) => r.id);
  const [flatRows] = blockIds.length
    ? await sequelize.query(`SELECT id FROM flats WHERE block_id IN (${blockIds.join(",")})`)
    : [Promise.resolve([[]])];
  const flatIds = flatRows.map((r) => r.id);
  const [userRows] = await sequelize.query(`SELECT id FROM users WHERE society_id=${societyId}`);
  const userIds = userRows.map((r) => r.id);
  const inClause = (ids) => (ids.length ? `(${ids.join(",")})` : "(NULL)");

  await sequelize.query("SET FOREIGN_KEY_CHECKS=0");
  await sequelize.query(`DELETE FROM Payments WHERE bill_id IN (SELECT id FROM bills WHERE flat_id IN ${inClause(flatIds)})`);
  await sequelize.query(`DELETE FROM complaint_comments WHERE complaint_id IN (SELECT id FROM complaints WHERE flat_id IN ${inClause(flatIds)})`);
  await sequelize.query(`DELETE FROM bills WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM complaints WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM household_members WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM visitorlogs WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM visitor_preapprovals WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM vehicles WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM parking_requests WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM parcels WHERE flat_id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM amenity_bookings WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM amenities WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM parking_slots WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM guard_shifts WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM guard_logs WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM emergency_alerts WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM notifications WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM notices WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM documents WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM MaintenanceRates WHERE society_id=${societyId}`);
  await sequelize.query(`DELETE FROM user_documents WHERE user_id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM user_settings WHERE user_id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM FlatMemberships WHERE user_id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM flat_ownerships WHERE user_id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM resident_history WHERE user_id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM flats WHERE id IN ${inClause(flatIds)}`);
  await sequelize.query(`DELETE FROM floors WHERE block_id IN ${inClause(blockIds)}`);
  await sequelize.query(`DELETE FROM blocks WHERE id IN ${inClause(blockIds)}`);
  await sequelize.query(`DELETE FROM users WHERE id IN ${inClause(userIds)}`);
  await sequelize.query(`DELETE FROM societies WHERE id=${societyId}`);
  await sequelize.query("SET FOREIGN_KEY_CHECKS=1");
  console.log("🧹 Removed previously-seeded demo data.");
}

const seed = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    const existing = await Society.findOne({ where: { name: "Green Meadows Society" } });
    if (existing) {
      const userCount = await User.count({ where: { society_id: existing.id } });
      if (userCount > 0) {
        console.log("ℹ️  Demo data already exists (Society id:", existing.id, "| Users:", userCount, "). Skipping seed.");
        console.log("── LOGIN CREDENTIALS (password: Admin@123) ──");
        console.log("Super Admin  → superadmin@yopmail.com  (password: 123456)");
        console.log("Admin        → societyadmin32@yopmail.com");
        console.log("Committee    → committee@yopmail.com");
        console.log("Guard        → guard@yopmail.com");
        console.log("Guard 2      → guard2@yopmail.com");
        console.log("Accountant   → accountant@yopmail.com");
        console.log("Residents    → resident1@yopmail.com ... resident8@yopmail.com");
        console.log("OTP is sent to the registered email on login");
        process.exit(0);
      }
      await cleanupSociety(existing.id);
    }

    const PASSWORD = await bcrypt.hash("Admin@123", 10);
    const RESIDENTS = [];

    /* ════════════════════════════════════════════════
       1. SOCIETY + STRUCTURE
    ════════════════════════════════════════════════ */
    const society = await Society.create({
      name: "Green Meadows Society",
      address: "Plot 42, Palm Road, Wakad, Pune 411057",
    });

    const blockA = await Block.create({ name: "A", society_id: society.id, property_type: "Apartments" });
    const blockB = await Block.create({ name: "B", society_id: society.id, property_type: "Apartments" });
    const blockC = await Block.create({ name: "C", society_id: society.id, property_type: "RowHouse" });

    const floors = [];
    for (let f = 1; f <= 3; f++) {
      floors.push(await Floor.create({ floor_number: String(f), block_id: blockA.id }));
    }
    for (let f = 1; f <= 2; f++) {
      floors.push(await Floor.create({ floor_number: String(f), block_id: blockB.id }));
    }

    const flatA1 = await Flat.create({ flat_number: "A-101", block_id: blockA.id, floor_id: floors[0].id, flat_type: "1BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatA2 = await Flat.create({ flat_number: "A-102", block_id: blockA.id, floor_id: floors[0].id, flat_type: "2BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatA3 = await Flat.create({ flat_number: "A-201", block_id: blockA.id, floor_id: floors[1].id, flat_type: "2BHK", occupancy_status: "RENTED" });
    const flatA4 = await Flat.create({ flat_number: "A-202", block_id: blockA.id, floor_id: floors[1].id, flat_type: "3BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatA5 = await Flat.create({ flat_number: "A-301", block_id: blockA.id, floor_id: floors[2].id, flat_type: "3BHK", occupancy_status: "VACANT" });
    const flatB1 = await Flat.create({ flat_number: "B-101", block_id: blockB.id, floor_id: floors[3].id, flat_type: "1BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatB2 = await Flat.create({ flat_number: "B-102", block_id: blockB.id, floor_id: floors[3].id, flat_type: "2BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatB3 = await Flat.create({ flat_number: "B-201", block_id: blockB.id, floor_id: floors[4].id, flat_type: "3BHK", occupancy_status: "VACANT" });
    const flatC1 = await Flat.create({ flat_number: "C-1", block_id: blockC.id, floor_id: null, flat_type: "3BHK", occupancy_status: "OWNER_OCCUPIED" });
    const flatC2 = await Flat.create({ flat_number: "C-2", block_id: blockC.id, floor_id: null, flat_type: "2BHK", occupancy_status: "OWNER_OCCUPIED" });

    /* ════════════════════════════════════════════════
       2. USERS
    ════════════════════════════════════════════════ */
    const admin = await User.create({
      name: "Rohan Deshmukh",
      email: "societyadmin32@yopmail.com",
      phone: "9876500001",
      password: PASSWORD,
      role: "SOCIETY_ADMIN",
      roles: ["SOCIETY_ADMIN", "RESIDENT"],
      society_id: society.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    const committee = await User.create({
      name: "Priya Nair",
      email: "committee@yopmail.com",
      phone: "9876500002",
      password: PASSWORD,
      role: "COMMITTEE_MEMBER",
      roles: ["COMMITTEE_MEMBER", "RESIDENT"],
      society_id: society.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    const residentDefs = [
      { name: "Amit Sharma", email: "resident1@yopmail.com", phone: "9876500003", flat: flatA1, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Sneha Kulkarni", email: "resident2@yopmail.com", phone: "9876500004", flat: flatA2, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Vikram Patil", email: "resident3@yopmail.com", phone: "9876500005", flat: flatA4, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Neha Joshi", email: "resident4@yopmail.com", phone: "9876500006", flat: flatB1, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Karan Mehta", email: "resident5@yopmail.com", phone: "9876500007", flat: flatB2, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Divya Iyer", email: "resident6@yopmail.com", phone: "9876500008", flat: flatA3, type: "TENANT", occupancy: "RENTED" },
      { name: "Rajesh Kumar", email: "resident7@yopmail.com", phone: "9876500009", flat: flatC1, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
      { name: "Pooja Menon", email: "resident8@yopmail.com", phone: "9876500010", flat: flatC2, type: "OWNER", occupancy: "OWNER_OCCUPIED" },
    ];

    for (const def of residentDefs) {
      const u = await User.create({
        name: def.name,
        email: def.email,
        phone: def.phone,
        password: PASSWORD,
        role: "RESIDENT",
        roles: ["RESIDENT"],
        society_id: society.id,
        approval_status: "APPROVED",
        status: "ACTIVE",
        resident_type: def.type,
        vehicle_count: def.type === "OWNER" ? 1 : 0,
        occupant_count: 2,
        emergency_contact: { name: "Emergency Helpline", phone: "112" },
      });
      RESIDENTS.push(u);

      await Flat.update(
        { resident_id: u.id, occupancy_status: def.occupancy },
        { where: { id: def.flat.id } }
      );
    }

    const guard1 = await User.create({
      name: "Suresh Yadav",
      email: "guard@yopmail.com",
      phone: "9876500011",
      password: PASSWORD,
      role: "GUARD",
      roles: ["GUARD"],
      society_id: society.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    const guard2 = await User.create({
      name: "Manoj Tiwari",
      email: "guard2@yopmail.com",
      phone: "9876500012",
      password: PASSWORD,
      role: "GUARD",
      roles: ["GUARD"],
      society_id: society.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    const accountant = await User.create({
      name: "Sunita Rao",
      email: "accountant@yopmail.com",
      phone: "9876500013",
      password: PASSWORD,
      role: "ACCOUNTANT",
      roles: ["ACCOUNTANT"],
      society_id: society.id,
      approval_status: "APPROVED",
      status: "ACTIVE",
    });

    /* ════════════════════════════════════════════════
       3. MEMBERSHIPS / OWNERSHIP / HISTORY
    ════════════════════════════════════════════════ */
    for (let i = 0; i < residentDefs.length; i++) {
      const def = residentDefs[i];
      const u = RESIDENTS[i];

      await FlatMembership.create({
        flat_id: def.flat.id,
        user_id: u.id,
        role: def.type,
        is_staying: true,
        pays_maintenance: true,
        move_in_date: daysFromNow(-240),
        move_out_date: null,
        is_current: true,
      });

      await FlatOwnership.create({
        user_id: u.id,
        flat_id: def.flat.id,
        resident_type: def.type,
        flat_type: def.flat.flat_type,
        is_primary: true,
        is_current: true,
        move_in_date: addHours(-240 * 24),
      });

      await ResidentHistory.create({
        flat_id: def.flat.id,
        user_id: u.id,
        move_in_date: addHours(-240 * 24),
        move_out_date: null,
        is_current: true,
      });
    }

    // Admin also occupies flat A-101 (as owner, same as resident1) — record admin ownership
    await FlatMembership.create({
      flat_id: flatA1.id,
      user_id: admin.id,
      role: "OWNER",
      is_staying: true,
      pays_maintenance: true,
      move_in_date: daysFromNow(-300),
      move_out_date: null,
      is_current: true,
    });

    /* ════════════════════════════════════════════════
       4. HOUSEHOLD MEMBERS
    ════════════════════════════════════════════════ */
    const hhDefs = [
      { name: "Anita Sharma", relation: "Wife", phone: "9876500101", flat: flatA1, user: RESIDENTS[0], isAdmin: true },
      { name: "Rahul Sharma", relation: "Son", phone: "9876500102", flat: flatA1, user: RESIDENTS[0], isAdmin: false },
      { name: "Ramesh Kulkarni", relation: "Husband", phone: "9876500103", flat: flatA2, user: RESIDENTS[1], isAdmin: true },
      { name: "Mira Joshi", relation: "Daughter", phone: "9876500104", flat: flatB1, user: RESIDENTS[3], isAdmin: false },
      { name: "Arjun Mehta", relation: "Son", phone: "9876500105", flat: flatB2, user: RESIDENTS[4], isAdmin: false },
    ];
    for (const hh of hhDefs) {
      await HouseHoldMember.create({
        name: hh.name,
        relation: hh.relation,
        phone: hh.phone,
        flat_id: hh.flat.id,
        user_id: hh.user ? hh.user.id : null,
        isAdmin: hh.isAdmin,
      });
    }

    /* ════════════════════════════════════════════════
       5. BILLS + PAYMENTS
    ════════════════════════════════════════════════ */
    const billingMonths = ["July 2026", "June 2026", "May 2026", "April 2026"];
    const billRows = [];
    for (const def of residentDefs) {
      if (def.occupancy !== "OWNER_OCCUPIED") continue;
      for (let m = 0; m < billingMonths.length; m++) {
        const amount = def.flat.flat_type === "3BHK" ? 4500 : def.flat.flat_type === "2BHK" ? 3500 : 2500;
        const status = m === 0 ? "PENDING" : "PAID";
        const bill = await Bill.create({
          flat_id: def.flat.id,
          title: `Maintenance ${billingMonths[m]}`,
          amount,
          billing_month: billingMonths[m],
          due_date: new Date(daysFromNow(m * 30 - 15)),
          status,
        });
        billRows.push(bill);

        if (status === "PAID") {
          await Payment.create({
            bill_id: bill.id,
            amount,
            payment_mode: m === 1 ? "UPI" : m === 2 ? "NetBanking" : "Card",
            payment_date: new Date(daysFromNow(m * 30 - 20)),
          });
        }
      }
    }

    /* ════════════════════════════════════════════════
       6. NOTICES
    ════════════════════════════════════════════════ */
    const notices = [
      { title: "Annual General Meeting", description: "AGM will be held in the clubhouse on the last Sunday of the month at 11 AM. All residents are requested to attend.", file_url: null },
      { title: "Water Tank Cleaning", description: "Water supply will be interrupted on Saturday 10 AM - 2 PM for scheduled tank cleaning.", file_url: null },
      { title: "Diwali Celebration", description: "Join us for the society Diwali celebration on November 3rd. Cultural program from 6 PM followed by dinner.", file_url: null },
      { title: "Solar Panel Installation", description: "Solar panels will be installed on Block A and B rooftops next week. Access to the terrace will be restricted.", file_url: null },
    ];
    for (const n of notices) {
      await Notice.create({ society_id: society.id, title: n.title, description: n.description, file_url: n.file_url });
    }

    /* ════════════════════════════════════════════════
       7. COMPLAINTS + COMMENTS
    ════════════════════════════════════════════════ */
    const complaintDefs = [
      { res: RESIDENTS[0], flat: flatA1, title: "Water leakage in bathroom ceiling", description: "There is a persistent water leak in the bathroom ceiling from the flat above.", status: "IN_PROGRESS" },
      { res: RESIDENTS[1], flat: flatA2, title: "Lift not working", description: "Lift B has been out of service since yesterday morning. Request immediate repair.", status: "OPEN" },
      { res: RESIDENTS[4], flat: flatB2, title: "Garbage not collected", description: "Garbage from floor 2 corridor has not been collected for 2 days.", status: "RESOLVED" },
      { res: RESIDENTS[6], flat: flatC1, title: "Street light flickering", description: "The street lamp near Row House C-1 flickers at night and needs replacement.", status: "OPEN" },
    ];
    const complaintRows = [];
    for (const c of complaintDefs) {
      const complaint = await Complaint.create({
        resident_id: c.res.id,
        society_id: society.id,
        flat_id: c.flat.id,
        title: c.title,
        description: c.description,
        status: c.status,
        photo_url: null,
        photo_public_id: null,
      });
      complaintRows.push(complaint);

      await ComplaintComment.create({
        complaint_id: complaint.id,
        user_id: admin.id,
        message: "We have registered your complaint and assigned it to the maintenance team.",
        attachment_url: null,
      });
    }
    await ComplaintComment.create({
      complaint_id: complaintRows[0].id,
      user_id: RESIDENTS[0].id,
      message: "Thank you. Please let me know the estimated time for the fix.",
      attachment_url: null,
    });

    /* ════════════════════════════════════════════════
       8. VISITORS + PRE-APPROVALS
    ════════════════════════════════════════════════ */
    const visitorDefs = [
      { name: "Ravi Kumar", mobile: "9820000001", purpose: "GUEST", flat: flatA1, guard: guard1, vehicle: "MH12AB1234", exit: true },
      { name: "Amazon Delivery", mobile: "9820000002", purpose: "DELIVERY", flat: flatA2, guard: guard1, vehicle: null, exit: true },
      { name: "Electrician", mobile: "9820000003", purpose: "MAINTENANCE", flat: flatB1, guard: guard2, vehicle: "MH12CD5678", exit: true },
      { name: "Uber Cab", mobile: "9820000004", purpose: "CAB", flat: flatB2, guard: guard2, vehicle: "MH12EF9012", exit: false },
      { name: "Pizza Delivery", mobile: "9820000005", purpose: "DELIVERY", flat: flatC1, guard: guard1, vehicle: null, exit: false },
    ];
    for (const v of visitorDefs) {
      await VisitorLog.create({
        visitor_name: v.name,
        mobile: v.mobile,
        vehicle_number: v.vehicle,
        purpose: v.purpose,
        flat_id: v.flat.id,
        guard_id: v.guard.id,
        society_id: society.id,
        entry_time: addHours(-4),
        exit_time: v.exit ? addHours(-2) : null,
      });
    }

    await VisitorPreApproval.create({
      resident_id: RESIDENTS[0].id,
      society_id: society.id,
      flat_id: flatA1.id,
      visitor_name: "Ravi Kumar",
      mobile: "9820000001",
      vehicle_number: "MH12AB1234",
      purpose: "Family friend visit",
      otp: "1234",
      status: "USED",
      valid_date: daysFromNow(0),
    });
    await VisitorPreApproval.create({
      resident_id: RESIDENTS[4].id,
      society_id: society.id,
      flat_id: flatB2.id,
      visitor_name: "Sandeep Rao",
      mobile: "9820000006",
      vehicle_number: "MH12GH3456",
      purpose: "Guest visit",
      otp: "5678",
      status: "PENDING",
      valid_date: daysFromNow(2),
    });

    /* ════════════════════════════════════════════════
       9. GUARD SHIFTS + LOGS
    ════════════════════════════════════════════════ */
    await GuardShift.create({ guard_id: guard1.id, society_id: society.id, shift_type: "MORNING", start_date: daysFromNow(-7), end_date: daysFromNow(30) });
    await GuardShift.create({ guard_id: guard1.id, society_id: society.id, shift_type: "NIGHT", start_date: daysFromNow(1), end_date: daysFromNow(37) });
    await GuardShift.create({ guard_id: guard2.id, society_id: society.id, shift_type: "AFTERNOON", start_date: daysFromNow(-7), end_date: daysFromNow(30) });

    await GuardLog.create({ text: "Night round completed at 2 AM. All gates secure.", is_important: false, guard_id: guard2.id, society_id: society.id });
    await GuardLog.create({ text: "Found a lost key near the main gate. Kept at security office.", is_important: true, guard_id: guard1.id, society_id: society.id });
    await GuardLog.create({ text: "Fire alarm drill scheduled for Friday. Residents informed.", is_important: false, guard_id: guard1.id, society_id: society.id });

    /* ════════════════════════════════════════════════
       10. EMERGENCY ALERTS
    ════════════════════════════════════════════════ */
    await EmergencyAlert.create({
      message: "Medical emergency at Block B - an ambulance is needed.",
      guard_id: guard1.id,
      society_id: society.id,
      status: "RESOLVED",
      type: "MEDICAL",
      resident_id: RESIDENTS[3].id,
      flat_id: flatB1.id,
      source: "RESIDENT",
      created_at: addHours(-48),
      resolved_at: addHours(-47),
    });
    await EmergencyAlert.create({
      message: "Water heater smoke reported from Block C - investigating.",
      guard_id: guard2.id,
      society_id: society.id,
      status: "ACTIVE",
      type: "FIRE",
      resident_id: null,
      flat_id: flatC2.id,
      source: "GUARD",
      created_at: addHours(-1),
      resolved_at: null,
    });

    /* ════════════════════════════════════════════════
       11. PARKING SLOTS + VEHICLES + REQUESTS
    ════════════════════════════════════════════════ */
    const slotA1 = await ParkingSlot.create({ society_id: society.id, parking_floor: "Basement 1", slot_number: "B1-01", flat_id: flatA1.id, resident_id: RESIDENTS[0].id, vehicle_type: "CAR", status: "ASSIGNED", parking_type: "DEFAULT" });
    const slotA2 = await ParkingSlot.create({ society_id: society.id, parking_floor: "Basement 1", slot_number: "B1-02", flat_id: flatA2.id, resident_id: RESIDENTS[1].id, vehicle_type: "CAR", status: "ASSIGNED", parking_type: "DEFAULT" });
    await ParkingSlot.create({ society_id: society.id, parking_floor: "Basement 2", slot_number: "B2-01", vehicle_type: "CAR", status: "AVAILABLE", parking_type: "DEFAULT" });
    await ParkingSlot.create({ society_id: society.id, parking_floor: "Basement 2", slot_number: "B2-02", vehicle_type: "BIKE", status: "AVAILABLE", parking_type: "EXTRA" });

    const v1 = await Vehicle.create({ vehicle_number: "MH12AB1234", vehicle_type: "CAR", resident_id: RESIDENTS[0].id, flat_id: flatA1.id, society_id: society.id, vehicle_name: "Hyundai i20", parking_slot_id: slotA1.id });
    await Vehicle.create({ vehicle_number: "MH12CD5678", vehicle_type: "CAR", resident_id: RESIDENTS[1].id, flat_id: flatA2.id, society_id: society.id, vehicle_name: "Maruti Swift", parking_slot_id: slotA2.id });
    await Vehicle.create({ vehicle_number: "MH12EF9012", vehicle_type: "BIKE", resident_id: RESIDENTS[4].id, flat_id: flatB2.id, society_id: society.id, vehicle_name: "Honda Shine", parking_slot_id: null });

    await ParkingRequest.create({
      resident_id: RESIDENTS[2].id,
      flat_id: flatA4.id,
      society_id: society.id,
      guest_name: "Vikram Patil",
      vehicle_number: "MH12GH3456",
      vehicle_type: "CAR",
      expected_arrival: addHours(3),
      duration_hours: 4,
      status: "PENDING",
      assigned_spot: null,
      parking_type: "VISITOR",
      vehicle_id: null,
    });
    await ParkingRequest.create({
      resident_id: RESIDENTS[0].id,
      flat_id: flatA1.id,
      society_id: society.id,
      guest_name: "Amit Sharma",
      vehicle_number: "MH12AB1234",
      vehicle_type: "CAR",
      expected_arrival: null,
      duration_hours: 24,
      status: "APPROVED",
      assigned_spot: "B1-01",
      parking_type: "RESIDENT",
      vehicle_id: v1.id,
    });

    /* ════════════════════════════════════════════════
       12. PARCELS
    ════════════════════════════════════════════════ */
    await Parcel.create({ resident_id: RESIDENTS[0].id, flat_id: flatA1.id, society_id: society.id, guard_id: guard1.id, courier_name: "Amazon", status: "COLLECTED", entry_time: addHours(-30), pickup_code: "1248", image: null });
    await Parcel.create({ resident_id: RESIDENTS[1].id, flat_id: flatA2.id, society_id: society.id, guard_id: guard1.id, courier_name: "Flipkart", status: "AT_GATE", entry_time: addHours(-1), pickup_code: "9031", image: null });
    await Parcel.create({ resident_id: RESIDENTS[4].id, flat_id: flatB2.id, society_id: society.id, guard_id: guard2.id, courier_name: "BlueDart", status: "AT_GATE", entry_time: addHours(-3), pickup_code: "5512", image: null });

    /* ════════════════════════════════════════════════
       13. AMENITIES + BOOKINGS
    ════════════════════════════════════════════════ */
    const clubhouse = await Amenity.create({ society_id: society.id, name: "Clubhouse", icon: "apartment", type: "PAID", booking_type: "FULL_DAY", rate_per_hour: 500, opening_time: "06:00", closing_time: "22:00", slot_duration: 60, capacity: 50, is_active: true, requires_approval: true });
    const gym = await Amenity.create({ society_id: society.id, name: "Gymnasium", icon: "fitness", type: "FREE", booking_type: "SLOT", rate_per_hour: 0, opening_time: "05:00", closing_time: "23:00", slot_duration: 60, capacity: 10, is_active: true, requires_approval: false });
    const pool = await Amenity.create({ society_id: society.id, name: "Swimming Pool", icon: "pool", type: "PAID", booking_type: "SLOT", rate_per_hour: 200, opening_time: "07:00", closing_time: "20:00", slot_duration: 60, capacity: 20, is_active: true, requires_approval: false });
    const hall = await Amenity.create({ society_id: society.id, name: "Party Hall", icon: "celebration", type: "PAID", booking_type: "FULL_DAY", rate_per_hour: 800, opening_time: "08:00", closing_time: "23:00", slot_duration: 120, capacity: 100, is_active: true, requires_approval: true });

    await AmenityBooking.create({ society_id: society.id, amenity_id: clubhouse.id, user_id: RESIDENTS[0].id, flat_id: flatA1.id, date: daysFromNow(3), start_time: "10:00", end_time: "14:00", status: "APPROVED", payment_status: "PAID" });
    await AmenityBooking.create({ society_id: society.id, amenity_id: gym.id, user_id: RESIDENTS[3].id, flat_id: flatB1.id, date: daysFromNow(1), start_time: "06:00", end_time: "07:00", status: "APPROVED", payment_status: "NA" });
    await AmenityBooking.create({ society_id: society.id, amenity_id: pool.id, user_id: RESIDENTS[4].id, flat_id: flatB2.id, date: daysFromNow(2), start_time: "08:00", end_time: "09:00", status: "PENDING", payment_status: "PAID" });
    await AmenityBooking.create({ society_id: society.id, amenity_id: hall.id, user_id: RESIDENTS[6].id, flat_id: flatC1.id, date: daysFromNow(5), start_time: "18:00", end_time: "22:00", status: "PAYMENT_PENDING", payment_status: "PENDING" });

    /* ════════════════════════════════════════════════
       14. DOCUMENTS
    ════════════════════════════════════════════════ */
    const docDefs = [
      { title: "Society Bye-Laws 2026", description: "Registered bye-laws of Green Meadows Society.", category: "Legal", file_name: "bye-laws.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/bye-laws.pdf", file_size: 245760, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS" },
      { title: "AGM Minutes - June 2026", description: "Minutes of the last annual general meeting.", category: "Meetings", file_name: "agm-minutes-jun26.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/agm-jun26.pdf", file_size: 102400, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS" },
      { title: "Visitor Policy", description: "Guidelines for visitor entry and gate passes.", category: "Guidelines", file_name: "visitor-policy.pdf", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/visitor-policy.pdf", file_size: 51200, mime_type: "application/pdf", visible_to: "ALL_RESIDENTS" },
      { title: "FY 2025-26 Budget", description: "Society annual budget breakdown.", category: "Finance", file_name: "budget-25-26.xlsx", file_url: "https://res.cloudinary.com/demo/raw/upload/docs/budget.xlsx", file_size: 40960, mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", visible_to: "ADMIN_ONLY" },
    ];
    for (const d of docDefs) {
      await Document.create({ ...d, society_id: society.id, uploaded_by: admin.id, is_active: true });
    }

    /* ════════════════════════════════════════════════
       15. USER DOCUMENTS (aadhar/pan)
    ════════════════════════════════════════════════ */
    const aadharUrl = "https://res.cloudinary.com/demo/image/upload/v1/users/aadhar_demo";
    const panUrl = "https://res.cloudinary.com/demo/image/upload/v1/users/pan_demo";
    for (const u of RESIDENTS.slice(0, 4)) {
      await UserDocuments.create({
        user_id: u.id,
        aadhar_url: aadharUrl,
        aadhar_public_id: "users/aadhar_demo",
        pan_url: panUrl,
        pan_public_id: "users/pan_demo",
      });
    }

    /* ════════════════════════════════════════════════
       16. MAINTENANCE RATES
    ════════════════════════════════════════════════ */
    const rateDefs = [
      ["1BHK", "OWNER", 2500],
      ["1BHK", "TENANT", 2750],
      ["2BHK", "OWNER", 3500],
      ["2BHK", "TENANT", 3800],
      ["3BHK", "OWNER", 4500],
      ["3BHK", "TENANT", 4900],
      ["ROW_HOUSE", "OWNER", 5000],
      ["ROW_HOUSE", "TENANT", 5400],
    ];
    for (const [flat_type, resident_type, amount] of rateDefs) {
      await MaintenanceRate.create({ society_id: society.id, maintenance_type: "FLAT", name: `${flat_type} ${resident_type} Maintenance`, flat_type, resident_type, amount, frequency: "MONTHLY", is_active: true });
    }

    /* ════════════════════════════════════════════════
       17. NOTIFICATIONS + USER SETTINGS
    ════════════════════════════════════════════════ */
    await Notification.create({ title: "New maintenance bill", message: "Your July 2026 maintenance bill is now available.", type: "BILL", society_id: society.id, user_id: RESIDENTS[0].id, receiver_role: "RESIDENT", receiver_user_id: RESIDENTS[0].id, is_read: false });
    await Notification.create({ title: "Gate pass request", message: "Ravi Kumar requested entry. Approve the gate pass.", type: "VISITOR", society_id: society.id, user_id: RESIDENTS[0].id, receiver_role: "RESIDENT", receiver_user_id: RESIDENTS[0].id, is_read: true });
    await Notification.create({ title: "New complaint", message: "Amit Sharma raised a complaint: Water leakage in bathroom ceiling.", type: "COMPLAINT", society_id: society.id, user_id: admin.id, receiver_role: "SOCIETY_ADMIN", receiver_user_id: admin.id, is_read: false });

    const allUserIds = [admin, committee, accountant, guard1, guard2, ...RESIDENTS].map((u) => u.id);
    for (const uid of allUserIds) {
      await UserSetting.create({ user_id: uid, emergency_alerts: true, visitor_entry: true, complaint_updates: true, notice_updates: true, sound_alerts: true, auto_logout: true });
    }

    /* ════════════════════════════════════════════════
       SUMMARY
    ════════════════════════════════════════════════ */
    console.log("✅ Demo data seeded successfully!\n");
    console.log("Society: Green Meadows Society");
    console.log("Blocks:", 3, "| Floors:", floors.length, "| Flats:", 10);
    console.log("Residents:", RESIDENTS.length, "| Guards:", 2, "| Accountant: 1 | Committee: 1");
    console.log("Bills:", billRows.length, "| Complaints:", complaintRows.length, "| Visitors: 5 | Amenities: 4\n");
    console.log("── LOGIN CREDENTIALS (password: Admin@123) ──");
    console.log("Admin       → societyadmin32@yopmail.com");
    console.log("Committee   → committee@yopmail.com");
    console.log("Guard       → guard@yopmail.com");
    console.log("Accountant  → accountant@yopmail.com");
    console.log("Residents   → resident1@yopmail.com ... resident8@yopmail.com");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    console.error(err);
    process.exit(1);
  }
};

seed();
