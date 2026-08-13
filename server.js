// const express = require("express");
// const cors = require("cors");
// require("dotenv").config();

// const http = require("http");
// const { Server } = require("socket.io");

// const db = require("./models");
// const sequelize = db.sequelize;

// const authRoutes = require("./routes/authRoutes.js");
// const societyRoutes = require("./routes/societyRoutes.js");
// const userRoutes = require("./routes/userRoutes.js");
// const blockRoutes = require("./routes/blockRoutes.js");
// const flatRoutes = require("./routes/flatRoutes.js");
// const noticeRoutes = require("./routes/noticeRoutes.js");
// const complaintRoutes = require("./routes/complaintRoutes.js");
// const infoRoutes = require("./routes/infoRoutes.js");
// // const accountantRoutes = require("./routes/accountantRoutes.js");
// const billRoutes = require("./routes/billRoutes.js");
// const paymentRoutes = require("./routes/paymentRoutes.js");
// const visitorRoutes = require("./routes/visitorRoutes.js");
// const householdRoutes = require("./routes/householdRoutes.js");
// const emergencyRoutes = require("./routes/emergencyRoutes");
// const preApprovalRoutes = require("./routes/preApprovalRoutes");
// const guardShiftRoutes = require("./routes/guardShiftRoutes");
// const publicRoutes = require("./routes/publicRoutes");
// const notificationRoutes = require("./routes/notificationRoutes");
// const adminRoutes = require("./routes/adminRoutes");
// const vehicleRoutes = require("./routes/vehicleRoutes");
// const reportRoutes = require("./routes/reportRoutes");
// const residentReportRoutes = require("./routes/residentReportRoutes");
// const parkingRoutes = require("./routes/parkingRoutes");
// const parkingSlotRoutes = require("./routes/parkingSlotRoutes");
// const amenityRoutes = require("./routes/amenityRoutes");
// const adminAmenityRoutes = require("./routes/adminAmenityRoutes");
// const settingRoutes = require("./routes/settingRoutes.js");
// const documentRoutes = require("./routes/documentRoutes");
// const guardLogRoutes = require("./routes/guardLogRoutes.js");
// const flatHistoryRoutes = require("./routes/flatHistoryRoutes");
// const floorRoutes = require("./routes/floorRoutes.js");
// const userDocumentRoutes = require("./routes/uploadDocumentRoutes");
// const membershipRoutes = require("./routes/memberShipRoutes");
// // OTP cleanup job
// const { startOtpCleanup } = require("./controllers/authControllers");

// const downloadRoute = require("./routes/downloadRoute");
// require("./utils/paymentExpiryJob");
// const app = express();

// /* === SOCKET SERVER === */

// const server = http.createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: "*",  
//   },
//   pingTimeout: 60000,
//   pingInterval: 25000,
// });

// // Make socket available globally
// global.io = io;
// io.on("connection", (socket) => {
//   console.log("User connected:", socket.id);

//   // 🔹 Default join (existing)
//   socket.on("join", ({ userId, role, societyId }) => {
//     socket.join(`user_${userId}`);
//     socket.join(`role_${role}`);
//     socket.join(`society_${societyId}`);

//     console.log(
//       `User ${userId} joined → user_${userId}, role_${role}, society_${societyId}`
//     );
//   });

//   // 🔥 ADD THIS (your requirement)
//   socket.on("join_society", (id) => {
//     if (id) {
//       socket.join(`society_${id}`);
//       console.log(`Joined society_${id}`);
//     }
//   });

//   socket.on("leave_society", (id) => {
//     if (id) {
//       socket.leave(`society_${id}`);
//       console.log(`Left society_${id}`);
//     }
//   });

//   // 🔹 Complaint rooms (existing)
//   socket.on("join_complaint", (complaintId) => {
//     socket.join(`complaint_${complaintId}`);
//   });

//   socket.on("leave_complaint", (complaintId) => {
//     socket.leave(`complaint_${complaintId}`);
//   });

//   // 🔹 Disconnect
//   socket.on("disconnect", () => {
//     console.log("User disconnected:", socket.id);
//   });
// });
// /* === MIDDLEWARE === */

// app.use(cors());
// app.use(express.json());

// /* === ROUTES === */

// app.use("/api/auth", authRoutes);
// app.use("/api/societies", societyRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/blocks", blockRoutes);
// app.use("/api/flats", flatRoutes);
// app.use("/api/notices", noticeRoutes);
// app.use("/api/complaints", complaintRoutes);
// app.use("/api/dashboard", infoRoutes);
// app.use("/api/bills", billRoutes);
// app.use("/api/payments", paymentRoutes);
// app.use("/api/visitors", visitorRoutes);
// app.use("/api/household", householdRoutes);
// app.use("/api/emergency", emergencyRoutes);
// app.use("/api/preapproval", preApprovalRoutes);
// app.use("/api/public", publicRoutes);
// app.use("/api/guard-shift", guardShiftRoutes);
// app.use("/api/notifications", notificationRoutes);
// app.use("/api/vehicles", vehicleRoutes);
// app.use("/api/admin", adminRoutes);
// app.use("/api/reports", reportRoutes);
// app.use("/api/resident", residentReportRoutes);
// app.use("/api/parking", parkingRoutes);
// app.use("/api/parcels", require("./routes/parcelRoutes"));
// app.use("/api/parking-slots", parkingSlotRoutes);
// app.use("/api/settings", settingRoutes);
// app.use("/api/guard-logs", guardLogRoutes);
// app.use("/api/amenities", amenityRoutes);
// app.use("/api/admin/amenities", adminAmenityRoutes);
// app.use("/api/documents", documentRoutes);
// app.use("/api/contacts", require("./routes/contactRoutes"));
// app.use("/api/floors", floorRoutes);

// app.use("/api", membershipRoutes);

// app.use("/api/flat-history", flatHistoryRoutes);

// app.use("/uploads", express.static("uploads"));
// // Add this with your other route imports


// // Add this with your other app.use() calls
// app.use("/api/download", downloadRoute);
// /* === DATABASE === */
// // In app.js — add this line with your other routes

// app.use("/api/user-documents", userDocumentRoutes);

// sequelize
//   .authenticate()
//   .then(() => {
//     console.log("DB connected");

//     // return sequelize.sync({ alter: true }); // Use alter for development
//     return sequelize.sync(); // Changed from alter:true to prevent redundant index creation (ER_TOO_MANY_KEYS)
//   })
//   .then(() => {
//     console.log("All models synced");

//     // Start OTP cleanup AFTER DB is ready
//     startOtpCleanup();
//   })
//   .catch((err) => console.error("DB Sync Error:", err));

// /* === ROOT === */

// app.get("/", (req, res) => {
//   res.send("API is running..");
// });

// /* === SERVER === */

// const PORT = process.env.PORT || 5000;

// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const db = require("./models");
const sequelize = db.sequelize;

const authRoutes           = require("./routes/authRoutes.js");
const societyRoutes        = require("./routes/societyRoutes.js");
const userRoutes           = require("./routes/userRoutes.js");
const blockRoutes          = require("./routes/blockRoutes.js");
const flatRoutes           = require("./routes/flatRoutes.js");
const noticeRoutes         = require("./routes/noticeRoutes.js");
const complaintRoutes      = require("./routes/complaintRoutes.js");
const infoRoutes           = require("./routes/infoRoutes.js");
const billRoutes           = require("./routes/billRoutes.js");
const paymentRoutes        = require("./routes/paymentRoutes.js");
const visitorRoutes        = require("./routes/visitorRoutes.js");
const householdRoutes      = require("./routes/householdRoutes.js");
const emergencyRoutes      = require("./routes/emergencyRoutes");
const preApprovalRoutes    = require("./routes/preApprovalRoutes");
const guardShiftRoutes     = require("./routes/guardShiftRoutes");
const publicRoutes         = require("./routes/publicRoutes");
const notificationRoutes   = require("./routes/notificationRoutes");
const adminRoutes          = require("./routes/adminRoutes");
const vehicleRoutes        = require("./routes/vehicleRoutes");
const reportRoutes         = require("./routes/reportRoutes");
const residentReportRoutes = require("./routes/residentReportRoutes");
const accountantRoutes     = require("./routes/accountantRoutes");
const parkingRoutes        = require("./routes/parkingRoutes");
const parkingSlotRoutes    = require("./routes/parkingSlotRoutes");
const amenityRoutes        = require("./routes/amenityRoutes");
const adminAmenityRoutes   = require("./routes/adminAmenityRoutes");
const settingRoutes        = require("./routes/settingRoutes.js");
const documentRoutes       = require("./routes/documentRoutes");
const guardLogRoutes       = require("./routes/guardLogRoutes.js");
const flatHistoryRoutes    = require("./routes/flatHistoryRoutes");
const floorRoutes          = require("./routes/floorRoutes.js");
const userDocumentRoutes   = require("./routes/uploadDocumentRoutes");
const membershipRoutes     = require("./routes/memberShipRoutes");
const downloadRoute        = require("./routes/downloadRoute");

// OTP cleanup job
const { startOtpCleanup } = require("./controllers/authControllers");

// Payment expiry job
require("./utils/paymentExpiryJob");

const app = express();

/* ─────────────────────────────────────────────
   SOCKET SERVER
───────────────────────────────────────────── */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Make socket available globally BEFORE any job requires it
global.io = io;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join personal + role + society rooms
  socket.on("join", ({ userId, role, societyId }) => {
    socket.join(`user_${userId}`);
    socket.join(`role_${role}`);
    socket.join(`society_${societyId}`);
    console.log(
      `User ${userId} joined → user_${userId}, role_${role}, society_${societyId}`
    );
  });

  socket.on("join_society", (id) => {
    if (id) {
      socket.join(`society_${id}`);
      console.log(`Joined society_${id}`);
    }
  });

  socket.on("leave_society", (id) => {
    if (id) {
      socket.leave(`society_${id}`);
      console.log(`Left society_${id}`);
    }
  });

  // Complaint rooms
  socket.on("join_complaint", (complaintId) => {
    socket.join(`complaint_${complaintId}`);
  });

  socket.on("leave_complaint", (complaintId) => {
    socket.leave(`complaint_${complaintId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* ─────────────────────────────────────────────
   MIDDLEWARE
───────────────────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ─────────────────────────────────────────────
   ROUTES
───────────────────────────────────────────── */
app.use("/api/auth",           authRoutes);
app.use("/api/societies",      societyRoutes);
app.use("/api/users",          userRoutes);
app.use("/api/blocks",         blockRoutes);
app.use("/api/flats",          flatRoutes);
app.use("/api/notices",        noticeRoutes);
app.use("/api/complaints",     complaintRoutes);
app.use("/api/dashboard",      infoRoutes);
app.use("/api/bills",          billRoutes);
app.use("/api/payments",       paymentRoutes);
app.use("/api/visitors",       visitorRoutes);
app.use("/api/household",      householdRoutes);
app.use("/api/emergency",      emergencyRoutes);
app.use("/api/preapproval",    preApprovalRoutes);
app.use("/api/public",         publicRoutes);
app.use("/api/guard-shift",    guardShiftRoutes);
app.use("/api/notifications",  notificationRoutes);
app.use("/api/vehicles",       vehicleRoutes);
app.use("/api/admin",          adminRoutes);
app.use("/api/reports",        reportRoutes);
app.use("/api/resident",       residentReportRoutes);
app.use("/api/accountant",     accountantRoutes);
app.use("/api/parking",        parkingRoutes);
app.use("/api/parcels",        require("./routes/parcelRoutes"));
app.use("/api/parking-slots",  parkingSlotRoutes);
app.use("/api/settings",       settingRoutes);
app.use("/api/guard-logs",     guardLogRoutes);
app.use("/api/amenities",      amenityRoutes);
app.use("/api/admin/amenities", adminAmenityRoutes);
app.use("/api/documents",      documentRoutes);
app.use("/api/contacts",       require("./routes/contactRoutes"));
app.use("/api/floors",         floorRoutes);
app.use("/api",                membershipRoutes);
app.use("/api/flat-history",   flatHistoryRoutes);
app.use("/api/download",       downloadRoute);
app.use("/api/user-documents", userDocumentRoutes);
app.use("/uploads",            express.static("uploads"));

/* ─────────────────────────────────────────────
   ROOT
───────────────────────────────────────────── */
app.get("/", (req, res) => {
  res.send("API is running..");
});

/* ─────────────────────────────────────────────
   DATABASE + SERVER START
───────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;

sequelize
  .authenticate()
  .then(() => {
    console.log("DB connected");
    return sequelize.sync();
  })
  .then(() => {
    console.log("All models synced");

    // Start OTP cleanup AFTER DB is ready
    startOtpCleanup();

    // Start the server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      /* ─────────────────────────────────────────
         JOBS — registered after DB sync + server
         start so global.io and all models are
         guaranteed to be ready.
      ───────────────────────────────────────── */

      // Daily 09:00 IST lease expiry reminder
      // (emails + in-app notification + socket + FCM push)
      require("./jobs/leaseReminderCron");
      console.log("[Jobs] Lease reminder cron registered.");
    });
  })
  .catch((err) => console.error("DB Sync Error:", err));
