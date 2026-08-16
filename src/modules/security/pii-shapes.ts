/**
 * Shape-based detection of personal data, shared by every boundary that needs
 * it.
 *
 * One implementation, deliberately. These patterns guard the analytics
 * boundary, the deletion tombstone and anything else that must not carry a
 * person's details onward, and a second copy is a second thing to keep in step
 * — the copy that drifts is always the one nobody remembers exists.
 *
 * The bias is over-eager: a dropped property is a gap in a chart, a leaked one
 * cannot be recalled. But over-eager has a floor. A pattern that matches
 * ordinary structured values is not cautious, it is broken — it drops the data
 * the boundary was supposed to pass, and the person debugging the empty chart
 * fixes it by weakening the check. Hence the timestamp exclusion below, which
 * is the one case where a naive phone pattern silently swallows everything.
 */

/** An ISO-8601 instant or date. Digits and dashes, and not a phone number. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value.trim());
}

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
/**
 * A run of digits long enough to be a phone number, allowing the punctuation
 * people actually type. Matches `+90 532 111 22 33` and `(0532) 111-2233`.
 */
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const PROVIDER_MESSAGE_ID = /\bwamid\.[A-Za-z0-9_-]+/i;
/** Any URL: it may be a signed media link, which is a credential. */
const URL_SHAPED = /\bhttps?:\/\/\S+/i;

/**
 * Whether a string looks like personal data.
 *
 * Timestamps are excluded before the phone check rather than after, because
 * `2026-08-19T12:00:00.000Z` is digits and dashes and matches the phone pattern
 * exactly. Left in, it makes every `occurred_at` look like a phone number,
 * which drops the timestamp from every event that carries one.
 */
export function looksLikePersonalData(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (isIsoTimestamp(trimmed)) return false;
  return (
    EMAIL.test(trimmed) ||
    PHONE.test(trimmed) ||
    PROVIDER_MESSAGE_ID.test(trimmed) ||
    URL_SHAPED.test(trimmed)
  );
}

/**
 * Whether a whole structure carries personal data anywhere inside it.
 *
 * Serialises and scans, so a value nested at any depth is caught. Timestamps
 * are stripped from the serialised form first, for the same reason as above:
 * a record whose only digits are its own `deletedAt` is clean, and a scan that
 * says otherwise is unusable.
 */
export function structureCarriesPersonalData(value: unknown): boolean {
  const serialised = JSON.stringify(value) ?? "";
  const withoutTimestamps = serialised.replace(
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g,
    "<timestamp>"
  );
  return (
    EMAIL.test(withoutTimestamps) ||
    PHONE.test(withoutTimestamps) ||
    PROVIDER_MESSAGE_ID.test(withoutTimestamps) ||
    URL_SHAPED.test(withoutTimestamps)
  );
}
