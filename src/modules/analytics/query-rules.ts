import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cursor pagination and cache keying.
 *
 * The pack's rules for this surface are short — cursor pagination everywhere,
 * no unbounded queries, workspace-scoped indexes, cache keys that always
 * include workspace and permission context, no cross-tenant cache reuse — and
 * they share one failure mode. Every one of them, broken, produces a page that
 * looks right: an offset that silently skips a row, a query that works until a
 * workspace has fifty thousand messages, a cached fragment served to the wrong
 * tenant. None of these announce themselves, which is why they are enforced in
 * one place rather than left to each call site.
 *
 * Cursors are keyset, not offset. Offset pagination against a table that is
 * still being written to skips and repeats rows as the earlier pages shift
 * underneath the reader, and an inbox is written to constantly.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Clamps a requested page size.
 *
 * Clamps rather than rejects: a caller asking for a thousand rows is usually a
 * UI bug or an over-eager script, and returning a hundred is more useful than
 * an error. What it must never do is honour the request, since one unbounded
 * query is all it takes to make a shared database unresponsive for everybody.
 */
export function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  const floored = Math.floor(requested);
  if (floored < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(floored, MAX_PAGE_SIZE);
}

export type Cursor = Readonly<{
  /** The sort key of the last row on the previous page. */
  occurredAt: string;
  /** Tie-break, so rows sharing a timestamp are neither skipped nor repeated. */
  id: string;
}>;

/**
 * Encodes a cursor, signed against tampering.
 *
 * A cursor is a position, not a permission — but an unsigned one is an
 * invitation to hand-edit, and the edited value goes straight into a query
 * predicate. Signing keeps the parser dealing with values this server produced.
 * The workspace is bound into the signature so a cursor cannot be carried from
 * one tenant to another: the query is workspace-scoped regardless, but a cursor
 * that verifies across tenants is a loose end that a later refactor can turn
 * into a leak.
 */
export function encodeCursor(cursor: Cursor, workspaceId: string, secret: string): string {
  const payload = Buffer.from(`${cursor.occurredAt}|${cursor.id}`, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${workspaceId}.${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeCursor(token: string, workspaceId: string, secret: string): Cursor | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${workspaceId}.${payload}`).digest("base64url"),
    "base64url"
  );
  if (supplied.length !== expected.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const divider = decoded.indexOf("|");
  if (divider <= 0) return null;

  const occurredAt = decoded.slice(0, divider);
  const id = decoded.slice(divider + 1);
  if (id === "" || Number.isNaN(Date.parse(occurredAt))) return null;

  return { occurredAt, id };
}

export type Page<T> = Readonly<{
  rows: readonly T[];
  nextCursor: Cursor | null;
}>;

/**
 * Slices a fetched batch into a page.
 *
 * Expects the caller to have fetched `pageSize + 1` rows. That extra row is how
 * "is there a next page" gets answered without a second count query — and a
 * count query on a large workspace-scoped table is exactly the unbounded query
 * the rules forbid.
 */
export function toPage<T extends { id: string; occurredAt: string }>(
  fetched: readonly T[],
  pageSize: number
): Page<T> {
  const rows = fetched.slice(0, pageSize);
  const hasMore = fetched.length > pageSize;
  const last = rows[rows.length - 1];
  return Object.freeze({
    rows,
    nextCursor: hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null
  });
}

export type CacheKeyInput = Readonly<{
  workspaceId: string;
  /** The caller's role, since what they may see depends on it. */
  role: string;
  resource: string;
  /** Bumped when the shape of what is cached changes. */
  version: string;
  /** Any additional discriminators, e.g. a filter. */
  discriminators?: Readonly<Record<string, string>>;
}>;

/**
 * Builds a cache key.
 *
 * Workspace, role and version are mandatory positional parts rather than
 * optional fields, because each one omitted is a specific incident: without the
 * workspace, one tenant is served another's data; without the role, a member
 * sees what an owner cached; without the version, a deploy that changes a
 * payload shape serves the old shape until the cache expires.
 */
export function buildCacheKey(input: CacheKeyInput): string {
  const parts = [
    `ws=${input.workspaceId}`,
    `role=${input.role}`,
    `res=${input.resource}`,
    `v=${input.version}`
  ];
  for (const [key, value] of Object.entries(input.discriminators ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(":");
}

/**
 * Whether a key is safe to use.
 *
 * A guard for the case the type system cannot catch: an empty workspace id
 * produces a well-formed key that collides across every tenant with the same
 * empty value.
 */
export function isSafeCacheKey(key: string): boolean {
  if (!key.startsWith("ws=")) return false;
  if (/(^|:)ws=(:|$)/.test(key)) return false;
  if (/(^|:)role=(:|$)/.test(key)) return false;
  if (/(^|:)v=(:|$)/.test(key)) return false;
  return true;
}
