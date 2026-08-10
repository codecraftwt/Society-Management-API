

const {
  Parcel,
  User,
  Flat,
  Block,
  Notification,
  HouseHoldMember,
  GuardShift,
  Floor,
} = require("../models");

const { Op } = require("sequelize");

/* ═══════════════════════════════════════
   HELPERS (IST-AWARE)
═══════════════════════════════════════ */

/**
 * Returns ALL flat IDs the user is associated with (as primary resident OR household member).
 * Used to validate that an owner-supplied flat_id actually belongs to them.
 */
const getAllFlatIdsForUser = async (userId) => {
  const ownedFlats = await Flat.findAll({ where: { resident_id: userId } });
  const memberRows = await HouseHoldMember.findAll({ where: { user_id: userId } });

  const ids = new Set();
  ownedFlats.forEach((f) => ids.add(f.id));
  memberRows.forEach((m) => ids.add(m.flat_id));
  return [...ids];
};

/**
 * Returns the single flat_id for a user — kept for backwards-compat
 * (tenants / family members who only ever have one flat).
 */
const getFlatIdForUser = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.id;

  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) return member.flat_id;

  return null;
};

/**
 * Given a flat_id, returns the primary resident_id on that flat.
 */
const getPrimaryResidentIdForFlat = async (flatId) => {
  const flat = await Flat.findByPk(flatId);
  return flat ? flat.resident_id : null;
};

/**
 * Legacy helper — finds primary resident for a user (used in GET parcels).
 */
const getPrimaryResidentId = async (userId) => {
  const flat = await Flat.findOne({ where: { resident_id: userId } });
  if (flat) return flat.resident_id;

  const member = await HouseHoldMember.findOne({ where: { user_id: userId } });
  if (member) {
    const f = await Flat.findByPk(member.flat_id);
    if (f) return f.resident_id;
  }
  return userId;
};

const generatePickupCode = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const getCurrentShiftType = () => {
  const hour = parseInt(
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  if (hour >= 8 && hour < 16) return "MORNING";
  if (hour >= 16 && hour < 24) return "AFTERNOON";
  return "NIGHT";
};

const getActiveShiftGuard = async (society_id) => {
  const today = getTodayIST();
  const currentShift = getCurrentShiftType();

  const shift = await GuardShift.findOne({
    where: {
      society_id,
      shift_type: currentShift,
      start_date: { [Op.lte]: today },
      end_date: { [Op.gte]: today },
    },
  });
  return shift ? shift.guard_id : null;
};

/* helper — fetch full parcel row with associations for socket payloads */
const getFullParcel = (id) =>
  Parcel.findByPk(id, {
    include: [
      {
        model: Flat,
        attributes: ["flat_number"],
        include: [
          {
            model: Floor,
            attributes: ["floor_number"],
            include: [{ model: Block, attributes: ["name"] }],
          },
        ],
      },
      { model: User, as: "resident", attributes: ["name"] },
    ],
  });

/* ═══════════════════════════════════════
   CREATE PARCEL
═══════════════════════════════════════ */

const createParcel = async (req, res) => {
  try {
    const { flat_id, courier_name } = req.body;
    const society_id = req.user.society_id;
    const activeRole = req.user.activeRole ?? req.user.role;

    let finalFlatId = flat_id;
    let finalResidentId = null;
    let status = "AT_GATE";
    let guard_id = null;
    let pickup_code = null;

    /* ── RESIDENT / FAMILY_MEMBER creates expected parcel ── */
    if (activeRole === "RESIDENT" || activeRole === "FAMILY_MEMBER") {

      if (flat_id) {
        /*
         * Owner supplied a specific flat_id (multi-flat owner scenario).
         * Validate it actually belongs to this user before trusting it.
         */
        const userFlatIds = await getAllFlatIdsForUser(req.user.id);

        const flatIdNum = parseInt(flat_id, 10);
        if (!userFlatIds.includes(flatIdNum) && !userFlatIds.includes(flat_id)) {
          return res.status(403).json({
            message: "You are not associated with the selected unit.",
          });
        }

        finalFlatId = flatIdNum || flat_id;
      } else {
        /*
         * No flat_id supplied — fall back to the single-flat lookup
         * (tenants and single-unit residents always hit this path).
         */
        const myFlatId = await getFlatIdForUser(req.user.id);
        if (!myFlatId) {
          return res.status(400).json({ message: "No flat assigned to your account." });
        }
        finalFlatId = myFlatId;
      }

      // ✅ Security: Ensure owners can't manage parcels for rented flats
      if (activeRole === "RESIDENT" && req.user.resident_type === "OWNER") {
        const flat = await Flat.findByPk(finalFlatId);
        if (flat && flat.occupancy_status === "RENTED") {
          return res.status(403).json({
            message: "Owners cannot manage parcels for units that are currently rented to a tenant.",
          });
        }
      }

      // Resolve the primary resident for the chosen flat
      finalResidentId = await getPrimaryResidentIdForFlat(finalFlatId);

      status = "EXPECTED";

      // Notify the on-duty guard
      const activeGuardId = await getActiveShiftGuard(society_id);
      if (activeGuardId) {
        const flat = await Flat.findByPk(finalFlatId, {
          include: [
            {
              model: Floor,
              attributes: ["floor_number"],
              include: [{ model: Block, attributes: ["name"] }],
            },
          ],
        });

        const blockName  = flat?.Floor?.Block?.name  || "";
        const flatNumber = flat?.flat_number          || "";
        const floorNum   = flat?.Floor?.floor_number  ?? "";
        const unitLabel  = [blockName, flatNumber && `Unit ${flatNumber}`, floorNum !== "" && `Floor ${floorNum}`]
          .filter(Boolean).join(", ");

        const notif = await Notification.create({
          society_id,
          receiver_user_id: activeGuardId,
          title: "New Expected Parcel 📦",
          message: `Parcel expected from ${courier_name}${unitLabel ? ` for ${unitLabel}` : ""}`,
          type: "PARCEL",
          is_read: false,
        });
        global.io?.to(`user_${activeGuardId}`).emit("new_notification", notif);
      }
    }

    /* ── GUARD creates direct AT_GATE parcel ── */
    if (activeRole === "GUARD") {
      const activeGuardId = await getActiveShiftGuard(society_id);

      if (activeGuardId !== req.user.id) {
        return res.status(403).json({
          message:
            "You are not on an active shift right now. Please check your shift schedule.",
        });
      }

      guard_id = req.user.id;
      pickup_code = generatePickupCode();

      const flat = await Flat.findByPk(finalFlatId);
      if (!flat) return res.status(404).json({ message: "Flat not found" });

      finalResidentId = flat.resident_id;

      if (finalResidentId) {
        const notif = await Notification.create({
          society_id,
          receiver_user_id: finalResidentId,
          title: "Parcel Arrived 📦",
          message: `Your parcel from ${courier_name} is at the gate. Code: ${pickup_code}`,
          type: "PARCEL",
          is_read: false,
        });
        global.io?.to(`user_${finalResidentId}`).emit("new_notification", notif);
        global.io?.to(`user_${finalResidentId}`).emit("parcel_otp", {
          parcelId: null,
          otp: pickup_code,
        });
      }
    }

    const parcel = await Parcel.create({
      society_id,
      flat_id: finalFlatId,
      resident_id: finalResidentId,
      courier_name,
      guard_id,
      status,
      pickup_code,
      entry_time: new Date(),
    });

    const full = await getFullParcel(parcel.id);

    /* ── Socket emissions ── */
    if (activeRole === "RESIDENT" || activeRole === "FAMILY_MEMBER") {
      global.io?.to(`user_${req.user.id}`).emit("parcel_created", full);

      const activeGuardId = await getActiveShiftGuard(society_id);
      if (activeGuardId) {
        global.io?.to(`user_${activeGuardId}`).emit("parcel_created", full);
      }

      // If the creator is a household member and not the primary resident,
      // also push to the primary resident's socket so their list updates
      if (finalResidentId && finalResidentId !== req.user.id) {
        global.io?.to(`user_${finalResidentId}`).emit("parcel_created", full);
      }
    } else if (activeRole === "GUARD") {
      global.io?.to(`user_${req.user.id}`).emit("parcel_created", full);
      if (finalResidentId) {
        global.io?.to(`user_${finalResidentId}`).emit("parcel_created", full);
      }
    }

    res.status(201).json(full);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════
   GET PARCELS  (paginated)
═══════════════════════════════════════ */

const getParcels = async (req, res) => {
  try {
    const { id, society_id } = req.user;
    const activeRole = req.user.activeRole ?? req.user.role;

    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.max(parseInt(req.query.limit) || 5, 1);
    const offset = (page - 1) * limit;

    const whereClause = { society_id };

    if (activeRole === "RESIDENT" || activeRole === "FAMILY_MEMBER") {
      /*
       * For multi-flat owners we want ALL their parcels across every flat,
       * not just the one tied to resident_id.  Gather every flat_id the
       * user owns/belongs to and filter on flat_id instead.
       */
      const userFlatIds = await getAllFlatIdsForUser(id);

      if (!userFlatIds.length) {
        return res.json({
          data: [],
          pagination: { page, limit, totalItems: 0, totalPages: 0 },
        });
      }

      // Use flat_id IN (...) so multi-flat owners see all their parcels
      whereClause.flat_id = { [Op.in]: userFlatIds };
    }

    const { count, rows } = await Parcel.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Flat,
          attributes: ["flat_number"],
          include: [
            {
              model: Floor,
              attributes: ["floor_number"],
              include: [{ model: Block, attributes: ["name"] }],
            },
          ],
        },
        { model: User, as: "resident", attributes: ["name"] },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        totalItems: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ═══════════════════════════════════════
   UPDATE PARCEL STATUS
═══════════════════════════════════════ */

const updateParcelStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, pickup_code } = req.body;
    const activeRole = req.user.activeRole ?? req.user.role;

    const parcel = await Parcel.findByPk(id);
    if (!parcel) return res.status(404).json({ message: "Parcel not found" });

    /* ── guard shift check ── */
    if (activeRole === "GUARD") {
      const activeGuardId = await getActiveShiftGuard(parcel.society_id);

      if (activeGuardId !== req.user.id) {
        return res.status(403).json({
          message:
            "You are not on an active shift right now. Please contact your admin.",
        });
      }

      parcel.handled_by = req.user.id;
      parcel.handled_at = new Date();
    }

    /* ── CANCEL (resident cancels while AT_GATE or EXPECTED) ── */
    if (status === "CANCELLED") {
      if (activeRole !== "RESIDENT" && activeRole !== "FAMILY_MEMBER") {
        return res
          .status(403)
          .json({ message: "Only residents can cancel parcels." });
      }

      // Extra safety: confirm the parcel belongs to one of the user's flats
      const userFlatIds = await getAllFlatIdsForUser(req.user.id);
      if (!userFlatIds.includes(parcel.flat_id)) {
        return res.status(403).json({ message: "This parcel does not belong to your unit." });
      }

      parcel.status = "CANCELLED";
      await parcel.save();

      const full = await getFullParcel(parcel.id);

      global.io?.to(`user_${req.user.id}`).emit("parcel_updated", full);

      const activeGuardId = await getActiveShiftGuard(parcel.society_id);
      if (activeGuardId) {
        const notif = await Notification.create({
          society_id: parcel.society_id,
          receiver_user_id: activeGuardId,
          title: "Parcel Cancelled ❌",
          message: `Parcel from ${parcel.courier_name} was cancelled by resident`,
          type: "PARCEL",
          is_read: false,
        });
        global.io?.to(`user_${activeGuardId}`).emit("new_notification", notif);
        global.io?.to(`user_${activeGuardId}`).emit("parcel_updated", full);
      }

      return res.json(full);
    }

    /* ── EXPECTED → AT_GATE (guard marks parcel arrived) ── */
    if (status === "AT_GATE" && parcel.status === "EXPECTED") {
      if (activeRole !== "GUARD") {
        return res
          .status(403)
          .json({ message: "Only guards can mark parcels as arrived." });
      }

      parcel.pickup_code = generatePickupCode();
      parcel.entry_time  = new Date();
      parcel.status      = "AT_GATE";
      parcel.guard_id    = req.user.id;
      await parcel.save();

      const full = await getFullParcel(parcel.id);

      global.io?.to(`user_${req.user.id}`).emit("parcel_updated", full);

      if (parcel.resident_id) {
        const notif = await Notification.create({
          society_id:       parcel.society_id,
          receiver_user_id: parcel.resident_id,
          title:   "Parcel Arrived 📦",
          message: `Your parcel from ${parcel.courier_name} is at the gate. Code: ${parcel.pickup_code}`,
          type:    "PARCEL",
          is_read: false,
        });
        global.io?.to(`user_${parcel.resident_id}`).emit("new_notification", notif);
        global.io?.to(`user_${parcel.resident_id}`).emit("parcel_otp", {
          parcelId: parcel.id,
          otp: parcel.pickup_code,
        });
        global.io?.to(`user_${parcel.resident_id}`).emit("parcel_updated", full);
      }

      return res.json(full);
    }

    /* ── AT_GATE → COLLECTED ── */
    if (status === "COLLECTED") {
      if (activeRole !== "GUARD") {
        return res
          .status(403)
          .json({ message: "Only guards can mark parcels as collected." });
      }

      if (parcel.pickup_code !== pickup_code) {
        return res.status(400).json({ message: "Invalid OTP" });
      }

      parcel.status      = "COLLECTED";
      parcel.pickup_time = new Date();
      await parcel.save();

      const full = await getFullParcel(parcel.id);

      global.io?.to(`user_${req.user.id}`).emit("parcel_collected", full);

      if (parcel.resident_id) {
        const notif = await Notification.create({
          society_id:       parcel.society_id,
          receiver_user_id: parcel.resident_id,
          title:   "Parcel Collected ✅",
          message: `Your parcel from ${parcel.courier_name} has been collected.`,
          type:    "PARCEL",
          is_read: false,
        });
        global.io?.to(`user_${parcel.resident_id}`).emit("new_notification", notif);
        global.io?.to(`user_${parcel.resident_id}`).emit("parcel_collected", full);
      }

      return res.json(full);
    }

    res.status(400).json({ message: "Invalid status transition" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = { createParcel, getParcels, updateParcelStatus };