const { Op } = require("sequelize");
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
 * `Flat.occupancy_status` is only a cached summary and can go stale when a
 * resident is moved out through the flat-history flow. The resident history is
 * the authoritative signal for who is physically present right now, so prefer
 * it whenever it exists for a tenant. Legacy rows without history fall back to
 * the membership flags.
 */
const getOccupancyContextForFlats = async (flatIds) => {
  const ids = [...new Set((flatIds || []).map(normalizeId).filter(Number.isFinite))];
  const context = new Map();
  if (ids.length === 0) return context;

  const [memberships, history] = await Promise.all([
    FlatMembership.findAll({
      where: { flat_id: { [Op.in]: ids }, is_current: true },
      include: [
        {
          model: User,
          required: false,
          attributes: ["id", "name", "email", "approval_status", "status", "resident_type"],
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
    const flatMemberships = memberships.filter((m) => normalizeId(m.flat_id) === id);
    const flatHistory = history.filter((h) => normalizeId(h.flat_id) === id);
    const currentResidentIds = new Set(
      flatHistory.filter((h) => h.is_current).map((h) => normalizeId(h.user_id))
    );

    const owner = flatMemberships.find((m) => m.role === "OWNER") || null;
    const tenants = flatMemberships.filter((m) => m.role === "TENANT");

    const activeTenant = tenants.find((membership) => {
      if (!membership.is_staying) return false;
      if (!isLeaseCurrent(membership.move_out_date, today)) return false;

      const tenantHistory = flatHistory.filter(
        (h) => normalizeId(h.user_id) === normalizeId(membership.user_id)
      );
      if (tenantHistory.length > 0) {
        return tenantHistory.some((h) => h.is_current);
      }
      return true;
    }) || null;

    const hasCurrentResident = currentResidentIds.size > 0;
    const occupancyStatus = activeTenant
      ? "RENTED"
      : hasCurrentResident || (owner && owner.is_staying)
        ? "OWNER_OCCUPIED"
        : "VACANT";

    context.set(id, {
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
