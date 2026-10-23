require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const db = require("./models");
const sequelize = db.sequelize;
const Complaint = require("./models/Complaint");

// OTP cleanup job
const { startOtpCleanup } = require("./controllers/authControllers");

// Payment expiry job
require("./utils/paymentExpiryJob");

// Visitor dwell-time overstay job (guard alerts)
require("./utils/passDwellJob");

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

// Every socket must present a valid JWT before it can join any room.
// Without this the `join` payload was trusted blindly and anyone could
// subscribe to `user_<victimId>` / `society_<anyId>` and read other
// people's notifications. See middlewares/socketAuth.js.
const { authenticate, resolveRoleFor, resolveSocietyFor, normaliseRole } = require("./middlewares/socketAuth");
io.use(authenticate);

// Roles that may see every complaint of the society they belong to.
const STAFF_ROLES = new Set([
  "SUPER_ADMIN",
  "SOCIETY_ADMIN",
  "ADMIN",
  "COMMITTEE_MEMBER",
]);

const SOCKET_DEBUG =
  process.env.DEBUG_SOCKET === "true" ||
  (process.env.DEBUG_SOCKET !== "false" && process.env.NODE_ENV !== "production");

const socketLog = (...args) => {
  if (SOCKET_DEBUG) console.log(...args);
};

io.on("connection", (socket) => {
  const identity = socket.data.user || {};
  socketLog(
    `User connected: ${socket.id} (user_${identity.id}, society_${identity.defaultSocietyId})`
  );

  // Join personal + role + society rooms.
  //
  // The client may *request* a role/society (role switch, society switch) but
  // never assert one: the requested values are validated against the grants
  // resolved from the verified handshake in socket.data.user.
  socket.on("join", (data) => {
    try {
      if (!identity.id) {
        socket.emit("join_error", { message: "Unauthenticated socket" });
        return;
      }

      const payload = data && typeof data === "object" ? data : {};
      const requestedSocietyId = payload.societyId;
      const requestedRole = payload.role;

      const society = resolveSocietyFor(identity, requestedSocietyId);
      if (!society.allowed) {
        socket.emit("join_error", {
          message: "Not authorised for the requested society",
          requestedSocietyId: requestedSocietyId ?? null,
        });
        socketLog(
          `Socket ${socket.id} refused society_${requestedSocietyId} (not a member)`
        );
        return;
      }

      const societyId = society.societyId;
      const role = resolveRoleFor(identity, societyId, requestedRole);

      const userRoom = `user_${identity.id}`;
      const roleRoom = role ? `role_${role}` : null;
      const societyRoom = societyId ? `society_${societyId}` : null;

      // Clean up previous rooms to prevent cross-society / cross-role leakage.
      // `user_` is included: a socket that changes identity must not keep
      // receiving the previous user's notifications.
      for (const room of socket.rooms) {
        if (
          (room.startsWith("society_") && room !== societyRoom) ||
          (room.startsWith("role_") && room !== roleRoom) ||
          (room.startsWith("user_") && room !== userRoom)
        ) {
          socket.leave(room);
          socketLog(`Socket ${socket.id} left old room: ${room}`);
        }
      }

      socket.join(userRoom);
      if (roleRoom) socket.join(roleRoom);
      if (societyRoom) socket.join(societyRoom);

      socketLog(
        `User ${identity.id} joined → ${userRoom}${roleRoom ? `, ${roleRoom}` : ""}${societyRoom ? `, ${societyRoom}` : ""}`
      );
    } catch (err) {
      console.error("Socket join error:", err.message);
    }
  });

  // Joining a society room is already covered by the `join` event above.
  // This handler is kept for backwards compatibility but only re-joins a
  // society the authenticated socket is actually scoped to.
  socket.on("join_society", (id) => {
    try {
      const society = resolveSocietyFor(identity, id);
      if (!society.allowed || !society.societyId) {
        socketLog(
          `Socket ${socket.id} refused join_society:${id} (not authorised)`
        );
        return;
      }
      socket.join(`society_${society.societyId}`);
      socketLog(`Joined society_${society.societyId}`);
    } catch (err) {
      console.error("Socket join_society error:", err.message);
    }
  });

  socket.on("leave_society", (id) => {
    try {
      const room = `society_${id}`;
      // A socket can only leave a room it actually joined.
      if (id && socket.rooms.has(room)) {
        socket.leave(room);
        socketLog(`Left ${room}`);
      }
    } catch (err) {
      console.error("Socket leave_society error:", err.message);
    }
  });

  // Complaint rooms.
  //
  // A complaint room carries the complaint's chat, so membership has to be
  // checked: the resident who filed it, or staff of the society it belongs to.
  socket.on("join_complaint", async (complaintId) => {
    try {
      const id = parseInt(complaintId, 10);
      if (!id) return;

      const complaint = await Complaint.findByPk(id, {
        attributes: ["id", "society_id", "resident_id"],
      });
      if (!complaint) {
        socket.emit("join_error", { message: "Complaint not found", complaintId: id });
        return;
      }

      const isOwner = Number(complaint.resident_id) === Number(identity.id);
      const society = resolveSocietyFor(identity, complaint.society_id);
      const isStaff =
        society.allowed &&
        (identity.isSuperAdmin ||
          STAFF_ROLES.has(normaliseRole(resolveRoleFor(identity, complaint.society_id))));

      if (!isOwner && !isStaff) {
        socket.emit("join_error", {
          message: "Not authorised for this complaint",
          complaintId: id,
        });
        socketLog(`Socket ${socket.id} refused complaint_${id}`);
        return;
      }

      socket.join(`complaint_${complaint.id}`);
      socketLog(`Socket ${socket.id} joined complaint_${complaint.id}`);
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
    socketLog(`User disconnected: ${socket.id} (user_${identity.id})`);
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
      ["bill_category", "ALTER TABLE bills ADD COLUMN bill_category VARCHAR(50) NOT NULL DEFAULT 'OTHER' AFTER status"],
      ["other_bill_type", "ALTER TABLE bills ADD COLUMN other_bill_type VARCHAR(255) NULL AFTER bill_category"],
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

    // Ensure role_permissions table is synced + role column is a VARCHAR (was an ENUM)
    try {
      if (db.RolePermission) {
        await db.RolePermission.sync();

        const rpCols = await sequelize
          .query(
            "SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permissions'"
          )
          .then(([rows]) => new Map(rows.map((r) => [r.COLUMN_NAME, r.COLUMN_TYPE])));
        const roleType = rpCols.get("role");
        if (roleType && roleType.startsWith("enum")) {
          await sequelize.query(
            "ALTER TABLE role_permissions MODIFY COLUMN role VARCHAR(40) NOT NULL"
          );
          console.log("[DB Migration] role_permissions.role widened to VARCHAR(40)");
        }

        console.log("[DB Migration] role_permissions table synced successfully");
      }
    } catch (err) {
      console.log("[DB Migration] Note syncing role_permissions:", err.message);
    }

    // Ensure cleaning_staff and parcel tables are synced
    try {
      if (db.CleaningStaff) await db.CleaningStaff.sync({ alter: true });
      if (db.CleaningStaffPass) await db.CleaningStaffPass.sync({ alter: true });
      if (db.CleaningStaffAttendance) await db.CleaningStaffAttendance.sync({ alter: true });
      if (db.Parcel) await db.Parcel.sync({ alter: true });
      if (db.GuardAttendance) await db.GuardAttendance.sync({ alter: true });
      console.log("[DB Migration] cleaning_staff, parcel & guard_attendance tables synced successfully");
    } catch (err) {
      console.log("[DB Migration] Note syncing tables:", err.message);
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
      if (!noticeCols.has("created_by_user_id")) {
        await sequelize.query("ALTER TABLE notices ADD COLUMN created_by_user_id INT NULL");
        console.log("[DB Migration] Added notices.created_by_user_id");
      }
      if (!noticeCols.has("created_by_name")) {
        await sequelize.query("ALTER TABLE notices ADD COLUMN created_by_name VARCHAR(255) NULL");
        console.log("[DB Migration] Added notices.created_by_name");
      }
      if (!noticeCols.has("created_by_role")) {
        await sequelize.query("ALTER TABLE notices ADD COLUMN created_by_role VARCHAR(50) NULL");
        console.log("[DB Migration] Added notices.created_by_role");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding notices columns:", err.message);
    }

    try {
      const userCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      if (!userCols.has("approved_by_user_id")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN approved_by_user_id INT NULL");
        console.log("[DB Migration] Added users.approved_by_user_id");
      }
      if (!userCols.has("approved_by_name")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN approved_by_name VARCHAR(255) NULL");
        console.log("[DB Migration] Added users.approved_by_name");
      }
      if (!userCols.has("approved_by_role")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN approved_by_role VARCHAR(50) NULL");
        console.log("[DB Migration] Added users.approved_by_role");
      }
      if (!userCols.has("approved_at")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN approved_at DATETIME NULL");
        console.log("[DB Migration] Added users.approved_at");
      }
      if (!userCols.has("profile_picture")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(500) NULL");
        console.log("[DB Migration] Added users.profile_picture");
      }
      if (!userCols.has("profile_picture_public_id")) {
        await sequelize.query("ALTER TABLE users ADD COLUMN profile_picture_public_id VARCHAR(255) NULL");
        console.log("[DB Migration] Added users.profile_picture_public_id");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding users approval columns:", err.message);
    }

    try {
      const accCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accountant_assignments'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      if (!accCols.has("is_from_society")) {
        await sequelize.query("ALTER TABLE accountant_assignments ADD COLUMN is_from_society TINYINT(1) NOT NULL DEFAULT 0");
        console.log("[DB Migration] Added accountant_assignments.is_from_society");
      }
      if (!accCols.has("updated_by")) {
        await sequelize.query("ALTER TABLE accountant_assignments ADD COLUMN updated_by INT NULL");
        console.log("[DB Migration] Added accountant_assignments.updated_by");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding accountant_assignments columns:", err.message);
    }

    try {
      const socCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'societies'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      if (!socCols.has("primary_color")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN primary_color VARCHAR(20) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.primary_color");
      }
      if (!socCols.has("accent_color")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN accent_color VARCHAR(20) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.accent_color");
      }
      if (!socCols.has("card_style")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN card_style VARCHAR(50) NULL DEFAULT 'default'");
        console.log("[DB Migration] Added societies.card_style");
      }
      if (!socCols.has("quick_link_style")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN quick_link_style VARCHAR(50) NULL DEFAULT 'default'");
        console.log("[DB Migration] Added societies.quick_link_style");
      }
      if (!socCols.has("theme_updated_by")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN theme_updated_by INT NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.theme_updated_by");
      }
      if (!socCols.has("theme_updated_at")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN theme_updated_at DATETIME NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.theme_updated_at");
      }
      if (!socCols.has("logo_url")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN logo_url VARCHAR(500) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.logo_url");
      }
      if (!socCols.has("logo_public_id")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN logo_public_id VARCHAR(255) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.logo_public_id");
      }
      // Geofence columns: declared on the Society model, so a missing column here
      // makes every Society query fail with "Unknown column 'Society.latitude'".
      if (!socCols.has("latitude")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN latitude DECIMAL(10,7) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.latitude");
      }
      if (!socCols.has("longitude")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN longitude DECIMAL(10,7) NULL DEFAULT NULL");
        console.log("[DB Migration] Added societies.longitude");
      }
      if (!socCols.has("location_radius")) {
        await sequelize.query("ALTER TABLE societies ADD COLUMN location_radius DECIMAL(8,2) NULL DEFAULT 50.00");
        console.log("[DB Migration] Added societies.location_radius");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding societies theme columns:", err.message);
    }

    try {
      const billCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      if (!billCols.has("issue_date")) {
        await sequelize.query("ALTER TABLE bills ADD COLUMN issue_date DATETIME NULL");
        console.log("[DB Migration] Added bills.issue_date");
      }
      if (!billCols.has("last_pay_date")) {
        await sequelize.query("ALTER TABLE bills ADD COLUMN last_pay_date DATETIME NULL");
        console.log("[DB Migration] Added bills.last_pay_date");
      }
    } catch (err) {
      console.log("[DB Migration] Note adding bills date columns:", err.message);
    }

    // --- Emergency alerts: widen source enum to admin senders + add admin_id ---
    try {
      const eaCols = await sequelize
        .query(
          "SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'emergency_alerts'"
        )
        .then(([rows]) => new Map(rows.map((r) => [r.COLUMN_NAME, r.COLUMN_TYPE])));
      const sourceType = eaCols.get("source");
      if (sourceType && !sourceType.includes("ADMIN")) {
        await sequelize.query(
          "ALTER TABLE emergency_alerts MODIFY COLUMN source ENUM('GUARD','RESIDENT','ADMIN','COMMITTEE','SUPER_ADMIN') NOT NULL"
        );
        console.log("[DB Migration] emergency_alerts.source widened for admin senders");
      }
      if (!eaCols.has("admin_id")) {
        await sequelize.query("ALTER TABLE emergency_alerts ADD COLUMN admin_id INT NULL");
        console.log("[DB Migration] Added emergency_alerts.admin_id");
      }
      if (!eaCols.has("resolved_by")) {
        await sequelize.query("ALTER TABLE emergency_alerts ADD COLUMN resolved_by INT NULL");
        console.log("[DB Migration] Added emergency_alerts.resolved_by");
      }
      if (!eaCols.has("resolution_notes")) {
        await sequelize.query("ALTER TABLE emergency_alerts ADD COLUMN resolution_notes TEXT NULL");
        console.log("[DB Migration] Added emergency_alerts.resolution_notes");
      }
      if (!eaCols.has("other_reason")) {
        await sequelize.query("ALTER TABLE emergency_alerts ADD COLUMN other_reason VARCHAR(255) NULL");
        console.log("[DB Migration] Added emergency_alerts.other_reason");
      }
    } catch (err) {
      console.log("[DB Migration] Note on emergency_alerts columns:", err.message);
    }

    /* ###################################################################
       FINANCIAL TRACKING MODULE MIGRATIONS
       - societies: opening balance columns
       - Payments: society/resident/amenity references, source & status
       - Backfill legacy payment rows (preserved, idempotent, safe to re-run)
       All statements are guarded so they are safe to re-run.
    ################################################################### */

    // Resolve the real Payments table name (Sequelize default is 'Payments').
    const paymentTableRows = await sequelize
      .query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Payments','payments')")
      .then(([rows]) => rows.map((r) => r.TABLE_NAME));
    const paymentsTable = paymentTableRows.find((n) => n === "Payments") || paymentTableRows[0] || "Payments";

    // --- A) societies: opening balance columns ---
    const societyCols = await sequelize
      .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'societies'")
      .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
    const societyColMigrations = [
      ["opening_balance", "ALTER TABLE societies ADD COLUMN opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER address"],
      ["opening_balance_effective_date", "ALTER TABLE societies ADD COLUMN opening_balance_effective_date DATE NULL AFTER opening_balance"],
      ["opening_balance_set_by", "ALTER TABLE societies ADD COLUMN opening_balance_set_by INT NULL AFTER opening_balance_effective_date"],
      ["opening_balance_set_at", "ALTER TABLE societies ADD COLUMN opening_balance_set_at DATETIME NULL AFTER opening_balance_set_by"],
    ];
    for (const [col, sql] of societyColMigrations) {
      if (!societyCols.has(col)) {
        try {
          await sequelize.query(sql);
          console.log(`[DB Migration] Added societies.${col}`);
        } catch (err) {
          console.log(`[DB Migration] Note adding societies.${col}:`, err.message);
        }
      }
    }

    // --- B) Payments: new financial columns + relax bill_id ---
    const paymentCols = await sequelize
      .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${paymentsTable}'`)
      .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));

    const paymentColMigrations = [
      ["society_id", `ALTER TABLE ${paymentsTable} ADD COLUMN society_id INT NULL AFTER bill_id`],
      ["resident_id", `ALTER TABLE ${paymentsTable} ADD COLUMN resident_id INT NULL AFTER society_id`],
      ["amenity_booking_id", `ALTER TABLE ${paymentsTable} ADD COLUMN amenity_booking_id INT NULL AFTER resident_id`],
      ["source", `ALTER TABLE ${paymentsTable} ADD COLUMN source ENUM('BILL','MAINTENANCE','AMENITY') NOT NULL DEFAULT 'BILL' AFTER payment_mode`],
      ["status", `ALTER TABLE ${paymentsTable} ADD COLUMN status ENUM('PENDING','SUCCESS','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING' AFTER source`],
    ];
    for (const [col, sql] of paymentColMigrations) {
      if (!paymentCols.has(col)) {
        try {
          await sequelize.query(sql);
          console.log(`[DB Migration] Added ${paymentsTable}.${col}`);
        } catch (err) {
          console.log(`[DB Migration] Note adding ${paymentsTable}.${col}:`, err.message);
        }
      }
    }

    // Allow amenity payments (bill_id NULL).
    try {
      await sequelize.query(`ALTER TABLE ${paymentsTable} MODIFY COLUMN bill_id INT NULL`);
      console.log(`[DB Migration] ${paymentsTable}.bill_id is now nullable`);
    } catch (err) {
      console.log(`[DB Migration] Note making ${paymentsTable}.bill_id nullable:`, err.message);
    }

    // --- C) Backfill legacy payment rows (preserves all history) ---
    const backfill = `
      UPDATE ${paymentsTable} p
      JOIN bills b  ON p.bill_id = b.id
      JOIN flats f  ON b.flat_id = f.id
      JOIN blocks bl ON f.block_id = bl.id
      SET
        p.society_id  = COALESCE(p.society_id, bl.society_id),
        p.resident_id = COALESCE(p.resident_id, f.resident_id),
        p.source      = IF(b.type = 'MAINTENANCE', 'MAINTENANCE', 'BILL'),
        p.status      = IF(b.status = 'PAID', 'SUCCESS', 'PENDING')
      WHERE p.society_id IS NULL OR p.society_id = 0 OR p.source = 'BILL'
    `;
    try {
      const [bkRes] = await sequelize.query(backfill);
      console.log(`[DB Migration] Backfilled ${paymentsTable} financial references (${bkRes.affectedRows} rows)`);
    } catch (err) {
      console.log(`[DB Migration] Note backfilling ${paymentsTable}:`, err.message);
    }

    // --- D) Indexes for the new payment lookups ---
    try {
      await sequelize.query(`ALTER TABLE ${paymentsTable} ADD INDEX idx_payments_society (society_id)`);
      console.log(`[DB Migration] Added idx_payments_society`);
    } catch (err) {
      console.log(`[DB Migration] Note adding idx_payments_society:`, err.message);
    }
    try {
      await sequelize.query(`ALTER TABLE ${paymentsTable} ADD INDEX idx_payments_amenity_booking (amenity_booking_id)`);
      console.log(`[DB Migration] Added idx_payments_amenity_booking`);
    } catch (err) {
      console.log(`[DB Migration] Note adding idx_payments_amenity_booking:`, err.message);
    }

    // --- E) Amenity bookings: single-record booking columns ---
    try {
      const abCols = await sequelize
        .query(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'amenity_bookings'"
        )
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));
      const abMigrations = [
        ["from_date", "ALTER TABLE amenity_bookings ADD COLUMN from_date DATE NULL AFTER date"],
        ["to_date",   "ALTER TABLE amenity_bookings ADD COLUMN to_date DATE NULL AFTER from_date"],
        ["slots",     "ALTER TABLE amenity_bookings ADD COLUMN slots JSON NULL AFTER to_date"],
      ];
      for (const [col, sql] of abMigrations) {
        if (!abCols.has(col)) {
          try {
            await sequelize.query(sql);
            console.log(`[DB Migration] Added amenity_bookings.${col}`);
          } catch (err) {
            console.log(`[DB Migration] Note adding amenity_bookings.${col}:`, err.message);
          }
        }
      }
      try {
        await sequelize.query(
          "CREATE INDEX idx_amenity_bookings_range ON amenity_bookings (amenity_id, from_date, to_date)"
        );
        console.log("[DB Migration] Added idx_amenity_bookings_range");
      } catch (err) {
        console.log("[DB Migration] Note adding idx_amenity_bookings_range:", err.message);
      }
    } catch (err) {
      console.log("[DB Migration] Note on amenity_bookings range columns:", err.message);
    }

    // ── Daily Pass + dwell-limit columns (gate passes) ────────────────────
    try {
      const vpaCols = await sequelize
        .query(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitor_preapprovals'"
        )
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));

      const vpaMigrations = [
        ["pass_type", "ALTER TABLE visitor_preapprovals ADD COLUMN pass_type VARCHAR(10) NOT NULL DEFAULT 'SINGLE' AFTER valid_date"],
        ["valid_until", "ALTER TABLE visitor_preapprovals ADD COLUMN valid_until DATE NULL AFTER valid_date"],
        ["daily_limit", "ALTER TABLE visitor_preapprovals ADD COLUMN daily_limit INT NOT NULL DEFAULT 2 AFTER valid_until"],
        ["dwell_minutes", "ALTER TABLE visitor_preapprovals ADD COLUMN dwell_minutes INT NOT NULL DEFAULT 45 AFTER daily_limit"],
      ];

      for (const [col, sql] of vpaMigrations) {
        if (!vpaCols.has(col)) {
          try {
            await sequelize.query(sql);
            console.log(`[DB Migration] Added visitor_preapprovals.${col}`);
          } catch (err) {
            console.log(`[DB Migration] Note adding visitor_preapprovals.${col}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.log("[DB Migration] Note on visitor_preapprovals columns:", err.message);
    }

    try {
      const vlogCols = await sequelize
        .query(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitorlogs'"
        )
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));

      const vlogMigrations = [
        ["dwell_minutes", "ALTER TABLE visitorlogs ADD COLUMN dwell_minutes INT NULL AFTER preapproval_id"],
        ["dwell_alerted", "ALTER TABLE visitorlogs ADD COLUMN dwell_alerted TINYINT(1) NOT NULL DEFAULT 0 AFTER dwell_minutes"],
      ];

      for (const [col, sql] of vlogMigrations) {
        if (!vlogCols.has(col)) {
          try {
            await sequelize.query(sql);
            console.log(`[DB Migration] Added visitorlogs.${col}`);
          } catch (err) {
            console.log(`[DB Migration] Note adding visitorlogs.${col}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.log("[DB Migration] Note on visitorlogs columns:", err.message);
    }

    // ── Notice audience targeting columns ─────────────────────────────────
    try {
      const noticeCols = await sequelize
        .query(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'"
        )
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));

      const noticeMigrations = [
        ["target_type", "ALTER TABLE notices ADD COLUMN target_type ENUM('SOCIETY', 'FLAT') NOT NULL DEFAULT 'SOCIETY' AFTER acknowledgement_required"],
        ["target_flat_id", "ALTER TABLE notices ADD COLUMN target_flat_id INT NULL DEFAULT NULL AFTER target_type"],
      ];

      for (const [col, sql] of noticeMigrations) {
        if (!noticeCols.has(col)) {
          try {
            await sequelize.query(sql);
            console.log(`[DB Migration] Added notices.${col}`);
          } catch (err) {
            console.log(`[DB Migration] Note adding notices.${col}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.log("[DB Migration] Note on notices columns:", err.message);
    }

    /* ###################################################################
       PARCEL ACCOUNTABILITY MIGRATIONS
       Four nullable columns that separate the two real gate events
       (arrival / handover) and record who raised the request, while
       guard_id keeps its legacy meaning untouched.
       Purely additive: no back-fill, no rewrite of historical rows.
       Guarded so they are safe to re-run on every boot.
    ################################################################### */
    try {
      const parcelCols = await sequelize
        .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parcels'")
        .then(([rows]) => new Set(rows.map((r) => r.COLUMN_NAME)));

      const parcelColMigrations = [
        ["requested_by",     "ALTER TABLE parcels ADD COLUMN requested_by INT NULL AFTER guard_id"],
        ["arrival_guard_id", "ALTER TABLE parcels ADD COLUMN arrival_guard_id INT NULL AFTER requested_by"],
        ["delivery_guard_id","ALTER TABLE parcels ADD COLUMN delivery_guard_id INT NULL AFTER arrival_guard_id"],
        ["pickup_time",      "ALTER TABLE parcels ADD COLUMN pickup_time DATETIME NULL AFTER entry_time"],
      ];
      for (const [col, sql] of parcelColMigrations) {
        if (!parcelCols.has(col)) {
          try {
            await sequelize.query(sql);
            console.log(`[DB Migration] Added parcels.${col}`);
          } catch (err) {
            console.log(`[DB Migration] Note adding parcels.${col}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.log("[DB Migration] Note on parcels columns:", err.message);
    }

    return sequelize.sync();
  })
  .then(async () => {
    console.log("All models synced");

    // Backfill AccountantAssignment for existing accountants
    try {
      const { User, AccountantAssignment } = db;
      const allUsers = await User.findAll();
      for (const u of allUsers) {
        const uRoles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role];
        if (uRoles.includes("ACCOUNTANT") && u.society_id) {
          const exists = await AccountantAssignment.findOne({ where: { user_id: u.id } });
          if (!exists) {
            await AccountantAssignment.create({
              user_id: u.id,
              society_id: u.society_id,
              is_society_resident: Boolean(uRoles.includes("RESIDENT") || u.role === "RESIDENT"),
              start_date: u.created_at || new Date(),
              status: u.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
              inactive_date: u.status === "INACTIVE" ? (u.updated_at || new Date()) : null,
            });
            console.log(`[DB Migration] Backfilled AccountantAssignment for user ${u.id} (${u.name})`);
          }
        }
      }
    } catch (err) {
      console.log("[DB Migration] Note on AccountantAssignment backfill:", err.message);
    }

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
