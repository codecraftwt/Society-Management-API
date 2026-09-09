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
      console.log("[DB Migration] Note uq_rate_society_type index:", err.message);
    }

    // --- D) flats table: add area_sqft column if missing ---
    const flatCols = await sequelize
      .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flats'")
      .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
    if (!flatCols.has("area_sqft")) {
      try {
        await sequelize.query("ALTER TABLE flats ADD COLUMN area_sqft DECIMAL(10,2) NULL");
        console.log("[DB Migration] Added flats.area_sqft");
      } catch (err) {
        console.log("[DB Migration] Note adding flats.area_sqft:", err.message);
      }
    }

    // --- E) notices table: add acknowledgement_required ---
    try {
      const noticeCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      if (!noticeCols.has("acknowledgement_required")) {
        await sequelize.query("ALTER TABLE notices ADD COLUMN acknowledgement_required TINYINT(1) NOT NULL DEFAULT 0");
        console.log("[DB Migration] Added notices.acknowledgement_required");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding notices.acknowledgement_required:", err.message);
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
