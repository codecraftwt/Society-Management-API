const { HouseHoldMember, Flat, Block, VisitorLog, User, Notification, UserSetting } = require("../models");
const { Op } = require("sequelize");
const { sendPushNotification } = require("../utils/pushNotification");

const VALID_HELPER_ROLES = ['Maid', 'Cook', 'Driver', 'Cleaner', 'Helper', 'Nanny', 'Daily Help'];

/* ====
   HELPER: Send Notifications to Flat Residents
==== */
const sendMultiFlatNotification = async (visitorLog, flatId, societyId, guardId, isEntry) => {
  try {
    const flat = await Flat.findByPk(flatId);
    if (!flat) return;

    const members = await HouseHoldMember.findAll({ where: { flat_id: flat.id }, attributes: ["user_id"] });
    const allUserIds = new Set();
    if (flat.resident_id) allUserIds.add(flat.resident_id);
    members.forEach(m => { if (m.user_id) allUserIds.add(m.user_id); });

    const usersToNotify = await User.findAll({
      where: { id: { [Op.in]: Array.from(allUserIds) } },
      attributes: ["id", "fcm_token"]
    });

    const actionText = isEntry ? "has arrived at the gate" : "has left the society";
    const titleText = isEntry ? "Daily Help Arrived" : "Daily Help Exited";
    const emoji = isEntry ? "🟢" : "⚪";

    for (const user of usersToNotify) {
      const settings = await UserSetting.findOne({ where: { user_id: user.id } });
      if (!settings || settings.visitor_entry === true) {
        
        // In-App Notification
        const notification = await Notification.create({
          title: titleText,
          message: `${emoji} Your Daily Help "${visitorLog.visitor_name}" ${actionText}.`,
          type: "VISITOR",
          action_type: "VIEW_VISITOR",
          action_route: "/resident/visitors",
          society_id: societyId,
          user_id: guardId,
          receiver_role: "RESIDENT",
          receiver_user_id: user.id
        });

        // Socket.io Realtime (if connected)
        if (global.io) {
          global.io.to(`user_${user.id}`).emit("new_notification", notification);
        }

        // Push Notification
        if (user.fcm_token) {
          await sendPushNotification(
            user.fcm_token,
            titleText,
            `${emoji} Your Daily Help "${visitorLog.visitor_name}" ${actionText}.`,
            { route: "/resident/visitors", visitorId: visitorLog.id.toString() }
          );
        }
      }
    }
  } catch (error) {
    console.error("Error sending daily help notification:", error);
  }
};

/* ====
   1. GET SOCIETY DAILY HELPS (GROUPED FOR GUARD)
==== */
exports.getSocietyDailyHelps = async (req, res) => {
  try {
    console.log(`\n--- [START] FetchING DAILY HELPS FOR SOCIETY: ${req.user.society_id} ---`);

    // 1. Find all flats in the guard's society
    const flats = await Flat.findAll({
      include: [{ model: Block, where: { society_id: req.user.society_id }, attributes: ["name"] }]
    });
    const flatIds = flats.map(f => f.id);
    console.log(`[DB] Found ${flats.length} flats in this society. Flat IDs:`, flatIds);

    // 2. Find all Household members in these flats who are Helpers
    const VALID_HELPER_ROLES = ['Maid', 'Cook', 'Driver', 'Cleaner', 'Helper', 'Nanny', 'Daily Help'];
    const helpers = await HouseHoldMember.findAll({
      where: {
        flat_id: { [Op.in]: flatIds },
        [Op.or]: [
          { relation: { [Op.in]: VALID_HELPER_ROLES } },
          { work: { [Op.in]: VALID_HELPER_ROLES } }
        ]
      }
    });
    console.log(`[DB] Found ${helpers.length} valid helpers in HouseHoldMember table.`);

    // 3. Group by Phone Number
    const groupedHelpers = {};
    for (const h of helpers) {
      const phone = h.phone || `NO_PHONE_${h.name}`; 
      
      if (!groupedHelpers[phone]) {
        groupedHelpers[phone] = {
          name: h.name,
          phone: h.phone,
          roles: new Set(),
          flatDetails: [],
          flatIds: []
        };
      }
      
      groupedHelpers[phone].roles.add(h.work || h.relation || 'Helper');
      
      // Match flat ID back to get Block Name & Flat Number
      const flatData = flats.find(f => f.id === h.flat_id);
      if (flatData) {
        groupedHelpers[phone].flatDetails.push(`${flatData.Block.name}-${flatData.flat_number}`);
        groupedHelpers[phone].flatIds.push(h.flat_id);
      }
    }
    console.log(`[LOGIC] Grouped helpers into ${Object.keys(groupedHelpers).length} unique profiles based on phone.`);

    // 4. Check Real-Time Gate Status (Inside/Outside)
    const result = [];
    for (const key in groupedHelpers) {
      const helper = groupedHelpers[key];
      
      const latestLog = await VisitorLog.findOne({
        where: { society_id: req.user.society_id, mobile: helper.phone },
        order: [['entry_time', 'DESC']]
      });

      let status = 'OUTSIDE';
      if (latestLog && !latestLog.exit_time) {
        status = 'INSIDE';
      }

      result.push({
        name: helper.name,
        phone: helper.phone,
        roles: Array.from(helper.roles).join(', '),
        flats: helper.flatDetails.join(', '), 
        flatIds: helper.flatIds, 
        status: status
      });
    }

    console.log(`[SUCCESS] Sending Payload:`, JSON.stringify(result, null, 2));
    console.log(`--- [END] FETCHING DAILY HELPS ---\n`);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`[ERROR] getSocietyDailyHelps Failed:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ====
   2. MARK ENTRY (MULTIPLE FLATS AT ONCE)
==== */
exports.markDailyHelpEntry = async (req, res) => {
  try {
    const { name, phone, flatIds } = req.body;

    if (!phone || !flatIds || !flatIds.length) {
      return res.status(400).json({ success: false, message: "Phone and flat assignments required." });
    }

    const createdLogs = [];

    // Loop and create an entry for EACH flat they work in
    for (const flatId of flatIds) {
      const visitor = await VisitorLog.create({
        visitor_name: name,
        purpose: 'SERVICE', // Or 'DAILY_HELP' based on your ENUM
        flat_id: flatId,
        mobile: phone,
        guard_id: req.user.id,
        society_id: req.user.society_id,
      });

      createdLogs.push(visitor);

      // Trigger notification for this specific flat
      await sendMultiFlatNotification(visitor, flatId, req.user.society_id, req.user.id, true);
    }

    res.status(201).json({ 
      success: true, 
      message: `Checked in to ${flatIds.length} flat(s) successfully.`,
      data: createdLogs
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ====
   3. MARK EXIT (MULTIPLE FLATS AT ONCE)
==== */
exports.markDailyHelpExit = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number required for checkout." });
    }

    // Find ALL active entries for this phone number today
    const activeLogs = await VisitorLog.findAll({
      where: {
        mobile: phone,
        society_id: req.user.society_id,
        exit_time: null
      }
    });

    if (activeLogs.length === 0) {
      return res.status(400).json({ success: false, message: "No active entries found inside the society." });
    }

    // Check them out of all flats
    for (const log of activeLogs) {
      log.exit_time = new Date();
      await log.save();

      // Trigger exit notification for this specific flat
      await sendMultiFlatNotification(log, log.flat_id, req.user.society_id, req.user.id, false);
    }

    res.json({ 
      success: true, 
      message: `Checked out of ${activeLogs.length} flat(s) successfully.` 
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ====
   4. GET RESIDENT HELPER ATTENDANCE & LEDGER
==== */
exports.getResidentHelperAttendance = async (req, res) => {
  try {
    const { phone } = req.params;
    const { month, year } = req.query; // e.g., month=4, year=2026
    
    // 1. Find user's flat
    let flatId = null;
    const flat = await Flat.findOne({ where: { resident_id: req.user.id } });
    if (flat) flatId = flat.id;
    else {
      const member = await HouseHoldMember.findOne({ where: { user_id: req.user.id } });
      if (member) flatId = member.flat_id;
    }

    if (!flatId) {
      return res.status(404).json({ success: false, message: "Flat not found for user." });
    }

    // 2. Set Date Boundaries
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);
    const daysInMonth = endDate.getDate();
    const today = new Date();
    
    // Determine how many days have actually passed in the month (for accurate absent calculation)
    const passedDays = (targetMonth === today.getMonth() + 1 && targetYear === today.getFullYear()) 
      ? today.getDate() 
      : daysInMonth;

    // 3. Fetch Logs for this helper at this flat
    const logs = await VisitorLog.findAll({
      where: {
        mobile: phone,
        flat_id: flatId,
        entry_time: {
          [Op.between]: [startDate, endDate]
        }
      },
      order: [['entry_time', 'DESC']]
    });

    // 4. Aggregate Attendance
    const attendanceMap = {};
    let totalMinutes = 0;

    logs.forEach(log => {
      const dateStr = new Date(log.entry_time).toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!attendanceMap[dateStr]) {
         attendanceMap[dateStr] = { entries: [], totalMinutesToday: 0 };
      }
      
      let duration = 0;
      if (log.exit_time) {
         duration = Math.round((new Date(log.exit_time) - new Date(log.entry_time)) / 60000); // in minutes
         totalMinutes += duration;
         attendanceMap[dateStr].totalMinutesToday += duration;
      }

      attendanceMap[dateStr].entries.push({
         in: log.entry_time,
         out: log.exit_time,
         durationStr: duration > 0 ? `${Math.floor(duration/60)}h ${duration%60}m` : 'Pending'
      });
    });

    const presentDays = Object.keys(attendanceMap).length;
    const absentDays = passedDays - presentDays;

    res.json({
      success: true,
      data: {
         phone,
         month: targetMonth,
         year: targetYear,
         daysInMonth,
         passedDays,
         presentDays,
         absentDays,
         totalHours: (totalMinutes / 60).toFixed(1),
         attendance: attendanceMap
      }
    });

  } catch (err) {
    console.error("Attendance Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};