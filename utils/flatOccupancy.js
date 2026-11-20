const { Op } = require("sequelize");
const Flat = require("../models/Flat");
const FlatMembership = require("../models/FlatMembership");
const ResidentHistory = require("../models/ResidentHistory");
const User = require("../models/User");
const { getCurrentISTDate } = require("./istTime");

const normalizeId = (value) => Number(value);

const toISODate = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const isLeaseCurrent = (moveOutDate, today = getCurrentISTDate()) => {
  if (!moveOutDate) return true;
  return toISODate(moveOutDate) >= today;
};

/*
 * Builds the effective occupancy for a batch of flats.
 *
 * Robustly inspects Flat.occupancy_status, FlatMembership, and ResidentHistory.
 * A flat is considered RENTED if it has an active tenant membership, a direct
 * tenant resident assignment, or its occupancy_status in the Flats table is RENTED.
 */
const getOccupancyContextForFlats = async (flatIds) => {
  const ids = [...new Set((flatIds || []).map(normalizeId).filter(Number.isFinite))];
  const context = new Map();
  if (ids.length === 0) return context;

  const [flats, memberships, history] = await Promise.all([
    Flat.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ["id", "flat_number", "occupancy_status", "resident_id"],
      include: [
        {
          model: User,
          required: false,
          attributes: ["id", "name", "email", "phone", "approval_status", "status", "resident_type"],
        },
      ],
    }),
    FlatMembership.findAll({
      where: { flat_id: { [Op.in]: ids }, is_current: true },
      include: [
        {
          model: User,
          required: false,
          attributes: ["id", "name", "email", "phone", "approval_status", "status", "resident_type"],
        },
      ],
    }),
    ResidentHistory.findAll({
      where: { flat_id: { [Op.in]: ids } },
      attributes: ["flat_id", "user_id", "is_current"],
    }),
  ]);

  const today = getCurrentISTDate();

  for (const id of ids) {
    const flatRecord = flats.find((f) => normalizeId(f.id) === id) || null;
    const flatMemberships = memberships.filter((m) => normalizeId(m.flat_id) === id);
    const flatHistory = history.filter((h) => normalizeId(h.flat_id) === id);
    const currentResidentIds = new Set(
      flatHistory.filter((h) => h.is_current).map((h) => normalizeId(h.user_id))
    );

    const owner = flatMemberships.find((m) => String(m.role || "").toUpperCase() === "OWNER") || null;
    const tenants = flatMemberships.filter((m) =>
      String(m.role || "").toUpperCase() === "TENANT" ||
      String(m.User?.resident_type || "").toUpperCase() === "TENANT"
    );

    let activeTenant = tenants.find((membership) => {
      if (membership.User?.approval_status === "REJECTED") return false;
      if (membership.is_staying === false && membership.move_out_date && !isLeaseCurrent(membership.move_out_date, today)) {
        return false;
      }

      const tenantHistory = flatHistory.filter(
        (h) => normalizeId(h.user_id) === normalizeId(membership.user_id)
      );
      if (tenantHistory.length > 0 && !tenantHistory.some((h) => h.is_current)) {
        return false;
      }
      return true;
    }) || null;

    // Fallback: Check flat's direct resident if marked as tenant or flat is RENTED
    if (!activeTenant && flatRecord && flatRecord.User) {
      const isUserTenant = String(flatRecord.User.resident_type || "").toUpperCase() === "TENANT";
      const isFlatRented = String(flatRecord.occupancy_status || "").toUpperCase() === "RENTED";
      if ((isUserTenant || isFlatRented) && flatRecord.User.approval_status !== "REJECTED") {
        activeTenant = {
          User: flatRecord.User,
          user_id: flatRecord.resident_id,
          role: "TENANT",
          is_staying: true,
          is_current: true,
        };
      }
    }

    const isFlatMarkedRented = String(flatRecord?.occupancy_status || "").toUpperCase() === "RENTED";
    const hasCurrentResident = currentResidentIds.size > 0;
    const occupancyStatus = (activeTenant || isFlatMarkedRented)
      ? "RENTED"
      : hasCurrentResident || (owner && owner.is_staying !== false) || String(flatRecord?.occupancy_status || "").toUpperCase() === "OWNER_OCCUPIED"
        ? "OWNER_OCCUPIED"
        : (flatRecord?.occupancy_status || "VACANT");

    context.set(id, {
      flat: flatRecord,
      memberships: flatMemberships,
      owner,
      tenants,
      activeTenant,
      currentResidentIds,
      occupancyStatus,
    });
  }

  return context;
};

const getActiveTenantForFlat = async (flatId) => {
  const id = normalizeId(flatId);
  const context = await getOccupancyContextForFlats([id]);
  return context.get(id)?.activeTenant || null;
};

module.exports = {
  isLeaseCurrent,
  getOccupancyContextForFlats,
  getActiveTenantForFlat,
};
