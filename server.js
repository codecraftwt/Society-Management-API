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

require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const db = require("./models");
const sequelize = db.sequelize;

// OTP cleanup job
const { startOtpCleanup } = require("./controllers/authControllers");

// Payment expiry job
require("./utils/paymentExpiryJob");

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

  // Join personal + role + society rooms (safely guarded)
  socket.on("join", (data) => {
    try {
      if (!data || typeof data !== "object") return;
      const { userId, role, societyId } = data;
      if (userId) socket.join(`user_${userId}`);
      if (role) socket.join(`role_${role}`);
      if (societyId) socket.join(`society_${societyId}`);
      console.log(
        `User ${userId} joined → user_${userId}, role_${role}, society_${societyId}`
      );
    } catch (err) {
      console.error("Socket join error:", err.message);
    }
  });

  socket.on("join_society", (id) => {
    try {
      if (id) {
        socket.join(`society_${id}`);
        console.log(`Joined society_${id}`);
      }
    } catch (err) {
      console.error("Socket join_society error:", err.message);
    }
  });

  socket.on("leave_society", (id) => {
    try {
      if (id) {
        socket.leave(`society_${id}`);
        console.log(`Left society_${id}`);
      }
    } catch (err) {
      console.error("Socket leave_society error:", err.message);
    }
  });

  // Complaint rooms
  socket.on("join_complaint", (complaintId) => {
    try {
      if (complaintId) socket.join(`complaint_${complaintId}`);
    } catch (err) {
      console.error("Socket join_complaint error:", err.message);
    }
  });

  socket.on("leave_complaint", (complaintId) => {
    try {
      if (complaintId) socket.leave(`complaint_${complaintId}`);
    } catch (err) {
      console.error("Socket leave_complaint error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* ─────────────────────────────────────────────
   DATABASE + SERVER START
───────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;

sequelize
  .authenticate()
  .then(async () => {
    console.log("DB connected");
    try {
      await sequelize.query("ALTER TABLE bills MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'PENDING'");
      console.log("[DB Migration] Updated bills.status column to VARCHAR(50)");
    } catch (err) {
      console.log("[DB Migration] Note on bills status column:", err.message);
    }
    try {
      await sequelize.query("ALTER TABLE guard_shifts DROP INDEX guard_shifts_guard_id_society_id_shift_type");
      console.log("[DB Migration] Removed guard_shifts unique constraint on (guard_id, society_id, shift_type)");
    } catch (err) {
      console.log("[DB Migration] Note on guard_shifts unique constraint:", err.message);
    }

    /* ###################################################################
       MAINTENANCE MANAGEMENT MODULE MIGRATIONS
       Adds the three genuinely-missing Bill columns and the
       MaintenanceRates columns needed for LUMPSUM / SQ_FEET / FLAT configs.
       All statements are guarded so they are safe to re-run.
    ################################################################### */

    // --- A) bills table: add maintenance module columns ---
    const billCols = await sequelize
      .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills'")
      .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
    const billColMigrations = [
      ["type", "ALTER TABLE bills ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'BILL' AFTER status"],
      ["maintenance_rate_id", "ALTER TABLE bills ADD COLUMN maintenance_rate_id INT NULL AFTER type"],
      ["calculation_details", "ALTER TABLE bills ADD COLUMN calculation_details TEXT NULL AFTER maintenance_rate_id"],
    ];
    for (const [col, sql] of billColMigrations) {
      if (!billCols.has(col)) {
        try {
          await sequelize.query(sql);
          console.log(`[DB Migration] Added bills.${col}`);
        } catch (err) {
          console.log(`[DB Migration] Note adding bills.${col}:`, err.message);
        }
      }
    }

    // --- B) MaintenanceRates table: add new columns + backfill ---
    const rateCols = await sequelize
      .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MaintenanceRates'")
      .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
    const rateColMigrations = [
      ["maintenance_type", "ALTER TABLE MaintenanceRates ADD COLUMN maintenance_type VARCHAR(20) NULL AFTER society_id"],
      ["name", "ALTER TABLE MaintenanceRates ADD COLUMN name VARCHAR(255) NULL AFTER maintenance_type"],
      ["rate_per_sqft", "ALTER TABLE MaintenanceRates ADD COLUMN rate_per_sqft DECIMAL(10,2) NULL AFTER amount"],
      ["frequency", "ALTER TABLE MaintenanceRates ADD COLUMN frequency VARCHAR(20) NOT NULL DEFAULT 'MONTHLY' AFTER rate_per_sqft"],
      ["description", "ALTER TABLE MaintenanceRates ADD COLUMN description TEXT NULL AFTER frequency"],
      ["is_active", "ALTER TABLE MaintenanceRates ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER description"],
    ];
    for (const [col, sql] of rateColMigrations) {
      if (!rateCols.has(col)) {
        try {
          await sequelize.query(sql);
          console.log(`[DB Migration] Added MaintenanceRates.${col}`);
        } catch (err) {
          console.log(`[DB Migration] Note adding MaintenanceRates.${col}:`, err.message);
        }
      }
    }

    // Backfill existing old-style rows (flat_type based) as FLAT configs.
    await sequelize.query(
      "UPDATE MaintenanceRates SET maintenance_type = 'FLAT' WHERE maintenance_type IS NULL"
    );
    console.log("[DB Migration] Backfilled MaintenanceRates.maintenance_type = 'FLAT' for legacy rows");

    // --- C) Align nullability of the type-dependent columns with the model.
    // A LUMPSUM config stores flat_type = NULL, a SQ_FEET config stores amount = NULL,
    // and a FLAT config stores resident_type = NULL. The legacy schema had these NOT NULL,
    // so we must relax them before saving mixed config types. This is guarded to be re-runnable.
    const rateNullable = await sequelize
      .query(
        "SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MaintenanceRates' AND COLUMN_NAME IN ('flat_type','resident_type','amount')"
      )
      .then(([rows]) =>
        rows.reduce((acc, r) => {
          acc[r.COLUMN_NAME] = r.IS_NULLABLE === "YES";
          return acc;
        }, {})
      );

    const makeNullable = async (col, type) => {
      if (rateNullable[col]) return;
      try {
        await sequelize.query(`ALTER TABLE MaintenanceRates MODIFY COLUMN ${col} ${type} NULL`);
        console.log(`[DB Migration] Made MaintenanceRates.${col} nullable`);
      } catch (err) {
        console.log(`[DB Migration] Note making MaintenanceRates.${col} nullable:`, err.message);
      }
    };
    await makeNullable("flat_type", "ENUM('1BHK','2BHK','3BHK','ROW_HOUSE','COMMERCIAL')");
    await makeNullable("resident_type", "ENUM('OWNER','TENANT')");
    await makeNullable("amount", "DECIMAL(10,2)");

    // Add unique index for (society_id, maintenance_type, flat_type, resident_type)
    try {
      await sequelize.query(
        "ALTER TABLE MaintenanceRates ADD UNIQUE KEY uq_rate_society_type (society_id, maintenance_type, flat_type, resident_type)"
      );
      console.log("[DB Migration] Added uq_rate_society_type index on MaintenanceRates");
    } catch (err) {
      console.log("[DB Migration] Note on MaintenanceRates unique index:", err.message);
    }

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

/* ─────────────────────────────────────────────
   GLOBAL ERROR HANDLERS (PREVENT NODEMON CRASHES)
───────────────────────────────────────────── */
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process Error] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Process Error] Uncaught Exception thrown:", err);
});
