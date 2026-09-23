const DAILY_HELP_ROLES = ["Maid", "Cook", "Driver", "Cleaner", "Helper", "Nanny", "Gardener", "Daily Help"];

const DAILY_HELP_ROLES_LOWERCASE = DAILY_HELP_ROLES.map((r) => r.toLowerCase());

/**
 * Classify whether a HouseHoldMember is a Daily Help record.
 * A member is a helper when they have an explicit `work` value OR their
 * `relation` is one of the standard helper roles (legacy/lower-cased rows).
 * Used by both the household and daily-help endpoints so the two lenses
 * classify identically.
 */
const isDailyHelpMember = (member) => {
  const relation = (member.relation || "").toLowerCase();
  return Boolean(member.work) || DAILY_HELP_ROLES_LOWERCASE.includes(relation);
};

module.exports = { DAILY_HELP_ROLES, isDailyHelpMember };