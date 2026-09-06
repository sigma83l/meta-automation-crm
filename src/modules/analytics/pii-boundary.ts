import { looksLikePersonalData } from "@/src/modules/security/pii-shapes";

/**
 * What may leave for an external analytics tool, and what may never.
 *
 * The pack's rule: generic external analytics must never receive raw customer
 * messages, phone numbers, email addresses, attachments, or Meta payload PII.
 * The reason is not only regulatory. A workspace's customers never agreed to
 * anything with us, let alone with a third-party analytics vendor; they messaged
 * a business. Sending their words or their phone number onward is a disclosure
 * they had no part in, and it is irreversible the moment it is made.
 *
 * So the boundary is an allowlist, not a blocklist. A blocklist is wrong by
 * construction here: it approves every field nobody has thought about yet,
 * which is precisely the set that grows every time somebody adds a property to
 * an event payload. An allowlist fails in the safe direction — a new field is
 * dropped until somebody decides it is safe, and the cost of that mistake is a
 * missing chart rather than a disclosure that cannot be recalled.
 *
 * Pure by design, so the boundary can be tested exhaustively rather than
 * inspected.
 */

/**
 * Property names permitted to cross to an external consumer.
 *
 * Every entry is an identifier, a category, a count or a duration. None of them
 * can carry a person's words, contact details or the content of an attachment.
 */
export const EXTERNAL_SAFE_PROPERTIES: readonly string[] = Object.freeze([
  // Tenancy and routing. Opaque ids: they identify a row to us and mean nothing
  // to the vendor.
  "workspace_id",
  "event_group",
  "event_name",
  "occurred_at",
  // Categorical dimensions.
  "channel",
  "plan",
  "lifecycle_stage",
  "lead_status",
  "locale",
  "country",
  "source",
  "medium",
  "campaign",
  "referrer_host",
  "experiment_key",
  "variant",
  "model_role",
  "route_reason",
  "validation_result",
  "failure_code",
  "integration_state",
  "trigger",
  // Measures.
  "count",
  "quantity",
  "duration_ms",
  "latency_ms",
  "score",
  "threshold",
  "attempt",
  "funnel_step"
]);

/**
 * Property names that must never cross, whatever their value.
 *
 * Redundant with the allowlist by construction — anything absent is already
 * refused — and kept anyway, because these are the ones somebody will one day
 * argue for. The explicit refusal is the answer to that argument, and it makes
 * the accidental addition of `customer_phone` to the allowlist fail a test
 * rather than ship.
 */
export const NEVER_EXPORTED_PROPERTIES: readonly string[] = Object.freeze([
  "message_text",
  "message_body",
  "text",
  "body",
  "content",
  "transcript",
  "customer_name",
  "contact_name",
  "full_name",
  "email",
  "customer_email",
  "phone",
  "phone_number",
  "customer_phone",
  "wa_id",
  "attachment_url",
  "media_url",
  "file_name",
  "address",
  "note",
  "notes",
  "raw_payload",
  "meta_payload"
]);

/**
 * Whether a value looks like personal data regardless of what it is called.
 *
 * The allowlist governs field names; this governs contents. Both are needed,
 * because the failure that actually happens in practice is a permitted field
 * carrying something it should not — a `source` set to the customer's email
 * because somebody upstream used it as an identifier.
 *
 * Shared with the deletion tombstone check rather than duplicated: two copies
 * of a security boundary is two things to keep in step, and the copy that
 * drifts is always the one nobody remembers exists.
 */
export { looksLikePersonalData };

export type ExternalProperties = Readonly<Record<string, string | number | boolean>>;

export type BoundaryResult = Readonly<{
  properties: ExternalProperties;
  /** Names refused, so a caller can see what was dropped and why. */
  dropped: readonly string[];
}>;

/**
 * Filters an event payload down to what may cross the boundary.
 *
 * Returns what was dropped rather than silently discarding it: a property
 * vanishing without trace is how somebody spends an afternoon wondering why a
 * chart is empty, and then "fixes" it by widening the allowlist.
 */
export function toExternalProperties(payload: Readonly<Record<string, unknown>>): BoundaryResult {
  const properties: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (!EXTERNAL_SAFE_PROPERTIES.includes(key)) {
      dropped.push(key);
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      // Objects and arrays are refused wholesale. Recursing would mean deciding
      // the safety of a nested shape nobody declared, and a nested blob is the
      // usual way a raw provider payload ends up somewhere it should not be.
      dropped.push(key);
      continue;
    }
    if (looksLikePersonalData(value)) {
      dropped.push(key);
      continue;
    }
    properties[key] = value;
  }

  return { properties: Object.freeze(properties), dropped: Object.freeze(dropped) };
}

/**
 * Whether a payload is safe to forward at all.
 *
 * Separate from filtering on purpose. Filtering makes a payload safe by removing
 * things; this reports whether anything had to be removed, which is what a test
 * and an alert want to know. A rising drop rate means an event is being built
 * with fields nobody checked.
 */
export function isExternalSafe(payload: Readonly<Record<string, unknown>>): boolean {
  return toExternalProperties(payload).dropped.length === 0;
}
