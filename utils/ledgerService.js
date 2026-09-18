const { LedgerEntry, FinancialAuditLog } = require("../models");

const VALID_SOURCES = ["BILL", "MAINTENANCE", "AMENITY", "EXPENSE", "ADJUSTMENT"];
const VALID_TYPES = ["CREDIT", "DEBIT"];

/* Roles that carry finance/admin authority. Order = seniority for audit stamps. */
const ROLE_PRIORITY = ["SUPER_ADMIN", "SOCIETY_ADMIN", "ACCOUNTANT", "COMMITTEE_MEMBER", "ADMIN"];
/* Roles that never author finance actions on their own (consumer fallbacks). */
const CONSUMER_ROLES = ["RESIDENT", "TENANT", "GUARD", "FAMILY_MEMBER"];

/**
 * Normalize a role string (COMMITTEE is an alias for COMMITTEE_MEMBER).
 */
function normalizeRole(r) {
  const s = String(r || "").toUpperCase().replace(/\s+/g, "_").trim();
  if (s === "COMMITTEE") return "COMMITTEE_MEMBER";
  return s;
}

/**
 * Resolve the role that should be stamped on a ledger / audit row.
 *
 * The mobile/web clients fall back to a consumer role (e.g. RESIDENT) when no
 * active admin role header is sent, even though the actor holds a finance role.
 * This helper prefers the actor's active finance/admin role and, when the
 * active role is a pure consumer fallback, records the most senior finance role
 * the actor actually holds. This keeps audit attribution correct for actions
 * performed by accountants / committee members / super admins.
 */
function resolveActorRole(actor) {
  if (!actor) return null;
  const active = normalizeRole(actor.activeRole || actor.role);
  const roles = (Array.isArray(actor.roles) ? actor.roles : []).map(normalizeRole);

  if (ROLE_PRIORITY.includes(active)) return active;

  if (!active || CONSUMER_ROLES.includes(active)) {
    const held = roles.filter((r) => ROLE_PRIORITY.includes(r));
    if (held.length) return ROLE_PRIORITY.find((r) => held.includes(r)) || held[0];
  }

  return active || roles[0] || null;
}

/**
 * Create a ledger entry inside the given transaction.
 * The unique DB key (society_id, source, reference_id, type) prevents
 * duplicate entries for the same financial unit.
 */
async function createLedgerEntry({
  societyId,
  type,
  source,
  referenceId = null,
  amount,
  entryDate,
  description = null,
  actor,
  transaction,
}) {
  if (!societyId) throw new Error("society_id is required for a ledger entry");
  if (!VALID_TYPES.includes(type)) throw new Error(`Invalid ledger type: ${type}`);
  if (!VALID_SOURCES.includes(source)) throw new Error(`Invalid ledger source: ${source}`);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw new Error("Ledger amount must be a non-negative number");

  const existing = await LedgerEntry.findOne({
    where: { society_id: societyId, type, source, reference_id: referenceId || null },
    ...(transaction ? { transaction } : {}),
  });
  if (existing) return existing; // idempotent - never double post

  return LedgerEntry.create(
    {
      society_id: societyId,
      type,
      source,
      reference_id: referenceId,
      amount: amt,
      entry_date: entryDate || new Date().toISOString().slice(0, 10),
      description,
      created_by: actor?.id ?? null,
      created_by_role: resolveActorRole(actor),
    },
    transaction ? { transaction } : {}
  );
}

/**
 * Reverse a previously posted ledger entry (void/cancel).
 * Marks the original REVERSED and posts the opposite-type entry.
 */
async function reverseLedgerEntry({ entry, actor, reason, transaction }) {
  if (!entry || (entry.status && entry.status === "REVERSED")) return entry;

  const reversal = await LedgerEntry.create(
    {
      society_id: entry.society_id,
      type: entry.type === "CREDIT" ? "DEBIT" : "CREDIT",
      source: entry.source,
      reference_id: entry.reference_id,
      amount: Number(entry.amount),
      entry_date: new Date().toISOString().slice(0, 10),
      description: `Reversal: ${reason || "voided"}`,
      created_by: actor?.id ?? null,
      created_by_role: resolveActorRole(actor),
      status: "POSTED",
      reversal_of_id: entry.id,
    },
    transaction ? { transaction } : {}
  );

  await entry.update({ status: "REVERSED" }, transaction ? { transaction } : {});
  return reversal;
}

/**
 * Write an audit log row (outside or inside a transaction).
 */
async function auditLog({
  societyId,
  action,
  entityType = null,
  entityId = null,
  oldValue = null,
  newValue = null,
  reason = null,
  actor,
  transaction,
}) {
  return FinancialAuditLog.create(
    {
      society_id: societyId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldValue,
      new_value: newValue,
      reason,
      performed_by: actor?.id ?? null,
      performed_by_role: resolveActorRole(actor),
      performed_at: new Date(),
    },
    transaction ? { transaction } : {}
  );
}

module.exports = { createLedgerEntry, reverseLedgerEntry, auditLog, resolveActorRole, VALID_SOURCES, VALID_TYPES };