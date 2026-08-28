import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In-memory Supabase double for billing unit tests.
 *
 * The billing subsystem's highest-risk logic (callback completion, the
 * renewal cron, webhook consequence application) only exists inside
 * service-role code paths that talk to Postgres, so none of it was
 * reachable from `tests/unit`. This double reproduces the PostgREST filter
 * semantics those paths rely on (including null-comparison behaviour and
 * `.or(...)`) and re-implements the billing RPCs from
 * `supabase/migrations/20260730010000_billing_subscriptions.sql` so a state
 * transition can be exercised without Docker.
 *
 * It is a test seam, not a database: `tests/integration/billing-isolation.test.ts`
 * remains the authority for RLS, grants and the real single-use RPC.
 */

export type FakeRow = Record<string, unknown>;

export type FakeResult = Readonly<{
  data: unknown;
  error: { code: string; message: string } | null;
  count: number | null;
}>;

export type FakeRpcHandler = (
  args: Readonly<Record<string, unknown>>,
  database: FakeDatabase
) => FakeResult;

type Comparison = Readonly<{ column: string; op: string; value: unknown }>;
type Filter =
  | Readonly<{ kind: "and"; condition: Comparison }>
  | Readonly<{ kind: "or"; conditions: readonly Comparison[] }>
  | Readonly<{ kind: "not"; condition: Comparison }>;

function comparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const time = Date.parse(text);
    if (!Number.isNaN(time)) return time;
  }
  return text;
}

function ordered(left: unknown, right: unknown): number | null {
  const a = comparable(left),
    b = comparable(right);
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  const [x, y] = [String(a), String(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

function matches(row: FakeRow, condition: Comparison): boolean {
  const actual = row[condition.column] ?? null;
  switch (condition.op) {
    case "eq":
      return actual !== null && String(actual) === String(condition.value);
    case "neq":
      return actual === null || String(actual) !== String(condition.value);
    case "is":
      return condition.value === null ? actual === null : actual === condition.value;
    case "in":
      return (
        actual !== null &&
        (condition.value as readonly unknown[]).some((value) => String(value) === String(actual))
      );
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      // Postgres three-valued logic: a NULL column never satisfies a
      // comparison. The renewal cron's due-selection depends on this.
      const comparison = ordered(actual, condition.value);
      if (comparison === null) return false;
      if (condition.op === "lt") return comparison < 0;
      if (condition.op === "lte") return comparison <= 0;
      if (condition.op === "gt") return comparison > 0;
      return comparison >= 0;
    }
    default:
      throw new Error(`Fake Supabase does not implement filter "${condition.op}".`);
  }
}

/** Parses one PostgREST `column.op.value` term as used inside `.or(...)`. */
function parseTerm(term: string): Comparison {
  const first = term.indexOf(".");
  const second = term.indexOf(".", first + 1);
  if (first < 0 || second < 0) throw new Error(`Unparseable PostgREST filter term "${term}".`);
  const op = term.slice(first + 1, second);
  const raw = term.slice(second + 1);
  return {
    column: term.slice(0, first),
    op,
    // Inside `.or(...)` every term arrives as text, so `is.null` yields the
    // four-character string rather than the value. PostgREST reads these three
    // as literals for `is` only - `eq.null` really does compare against the
    // text - and without the distinction an `is.null` term silently matches
    // nothing, which reads as an empty result rather than as a broken filter.
    value:
      op === "is" && (raw === "null" || raw === "true" || raw === "false")
        ? raw === "null"
          ? null
          : raw === "true"
        : raw
  };
}

function project(row: FakeRow, columns: string): FakeRow {
  if (columns.trim() === "*") return { ...row };
  const projected: FakeRow = {};
  for (const raw of columns.split(",")) {
    const column = raw.trim();
    if (!column) continue;
    projected[column] = row[column] ?? null;
  }
  return projected;
}

export class FakeDatabase {
  readonly tables: Record<string, FakeRow[]>;
  readonly rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  private sequence = 0;

  constructor(tables: Readonly<Record<string, readonly FakeRow[]>> = {}) {
    this.tables = {};
    for (const [name, rows] of Object.entries(tables)) {
      this.tables[name] = rows.map((row) => ({ ...row }));
    }
  }

  rows(table: string): FakeRow[] {
    const existing = this.tables[table];
    if (existing) return existing;
    const created: FakeRow[] = [];
    this.tables[table] = created;
    return created;
  }

  /** Deterministic synthetic identifier; never a real provider reference. */
  nextId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }

  rpcArgs(name: string): Record<string, unknown>[] {
    return this.rpcCalls.filter((call) => call.name === name).map((call) => call.args);
  }
}

const emptyResult = (data: unknown): FakeResult => ({ data, error: null, count: null });

class FakeQuery implements PromiseLike<FakeResult> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private countMode = false;
  private headMode = false;
  private singleMode: "none" | "single" | "maybe" = "none";
  private readonly filters: Filter[] = [];
  // PostgREST applies order clauses in the order they were added, each one
  // breaking the previous one's ties. Keeping only the last would silently sort
  // by the tiebreak alone - a wrong order that reads as a working query.
  private readonly ordering: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private payload: FakeRow[] = [];
  private updates: FakeRow = {};
  private conflictColumns: string[] = [];

  constructor(
    private readonly database: FakeDatabase,
    private readonly table: string
  ) {}

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.columns = columns;
    this.countMode = options?.count !== undefined;
    this.headMode = options?.head === true;
    return this;
  }

  insert(values: FakeRow | FakeRow[]) {
    this.op = "insert";
    this.payload = Array.isArray(values) ? values.map((row) => ({ ...row })) : [{ ...values }];
    return this;
  }

  upsert(values: FakeRow | FakeRow[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = Array.isArray(values) ? values.map((row) => ({ ...row })) : [{ ...values }];
    this.conflictColumns = (options?.onConflict ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    return this;
  }

  update(values: FakeRow) {
    this.op = "update";
    this.updates = { ...values };
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "eq", value } });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "neq", value } });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "is", value } });
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push({ kind: "and", condition: { column, op: "in", value: values } });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "lt", value } });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "lte", value } });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "gt", value } });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: "and", condition: { column, op: "gte", value } });
    return this;
  }

  not(column: string, op: string, value: unknown) {
    this.filters.push({ kind: "not", condition: { column, op, value } });
    return this;
  }

  or(expression: string) {
    this.filters.push({
      kind: "or",
      conditions: expression
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean)
        .map(parseTerm)
    });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.limitCount = to - from + 1;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private selected(): FakeRow[] {
    let rows = this.database.rows(this.table).filter((row) =>
      this.filters.every((filter) => {
        if (filter.kind === "and") return matches(row, filter.condition);
        if (filter.kind === "not") return !matches(row, filter.condition);
        return filter.conditions.some((condition) => matches(row, condition));
      })
    );
    if (this.ordering.length > 0) {
      rows = [...rows].sort((left, right) => {
        for (const { column, ascending } of this.ordering) {
          const comparison = (ordered(left[column], right[column]) ?? 0) * (ascending ? 1 : -1);
          if (comparison !== 0) return comparison;
        }
        return 0;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private shape(rows: FakeRow[], count: number | null): FakeResult {
    if (this.headMode) return { data: null, error: null, count };
    const projected = rows.map((row) => project(row, this.columns));
    if (this.singleMode === "single") {
      if (projected.length !== 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "Expected exactly one row." },
          count
        };
      }
      return { data: projected[0] ?? null, error: null, count };
    }
    if (this.singleMode === "maybe") {
      if (projected.length > 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "Expected at most one row." },
          count
        };
      }
      return { data: projected[0] ?? null, error: null, count };
    }
    return { data: projected, error: null, count };
  }

  private execute(): FakeResult {
    if (this.op === "select") {
      const rows = this.selected();
      return this.shape(rows, this.countMode ? rows.length : null);
    }
    if (this.op === "insert" || this.op === "upsert") {
      const stored: FakeRow[] = [];
      for (const row of this.payload) {
        const prepared: FakeRow = {
          id: row.id ?? this.database.nextId(),
          created_at: row.created_at ?? new Date().toISOString(),
          ...row
        };
        const existing =
          this.op === "upsert" && this.conflictColumns.length > 0
            ? this.database
                .rows(this.table)
                .find((candidate) =>
                  this.conflictColumns.every(
                    (column) => String(candidate[column]) === String(prepared[column])
                  )
                )
            : undefined;
        if (existing) {
          for (const [key, value] of Object.entries(row)) existing[key] = value;
          stored.push(existing);
        } else {
          this.database.rows(this.table).push(prepared);
          stored.push(prepared);
        }
      }
      return this.shape(stored, this.countMode ? stored.length : null);
    }
    if (this.op === "update") {
      const rows = this.selected();
      for (const row of rows) {
        for (const [key, value] of Object.entries(this.updates)) row[key] = value;
      }
      return this.shape(rows, this.countMode ? rows.length : null);
    }
    const removed = this.selected();
    const table = this.database.rows(this.table);
    for (const row of removed) {
      const index = table.indexOf(row);
      if (index >= 0) table.splice(index, 1);
    }
    return this.shape(removed, this.countMode ? removed.length : null);
  }
}

/**
 * Re-implementations of the billing RPCs, deliberately mirroring the
 * migration's SQL semantics (single-use guard, dedupe key, atomic
 * fingerprint check) so a test that passes here means the same thing the
 * database would mean.
 */
function billingRpcHandlers(): Record<string, FakeRpcHandler> {
  return {
    consume_billing_callback_nonce: (args, database) => {
      const now = Date.now();
      const nonce = database
        .rows("billing_callback_nonces")
        .find(
          (row) =>
            String(row.workspace_id) === String(args.p_workspace_id) &&
            String(row.purpose) === String(args.p_purpose) &&
            String(row.state_hash) === String(args.p_state_hash) &&
            (row.consumed_at ?? null) === null &&
            Date.parse(String(row.expires_at)) >= now
        );
      if (!nonce) return emptyResult(false);
      nonce.consumed_at = new Date().toISOString();
      return emptyResult(true);
    },

    check_and_record_trial_fingerprint: (args, database) => {
      const hash = String(args.requested_fingerprint_hash);
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        return {
          data: null,
          error: { code: "P0001", message: "invalid fingerprint hash" },
          count: null
        };
      }
      const ledger = database.rows("private.trial_fraud_signals");
      const existing = ledger.find((row) => row.fingerprint_hash === hash);
      if (existing) {
        existing.occurrence_count = Number(existing.occurrence_count ?? 1) + 1;
        return emptyResult([
          {
            is_new: false,
            first_seen_workspace_id: existing.first_seen_workspace_id ?? null,
            first_seen_at: existing.first_seen_at ?? null
          }
        ]);
      }
      const created = {
        fingerprint_hash: hash,
        first_seen_workspace_id: args.trusted_workspace_id ?? null,
        first_seen_at: new Date().toISOString(),
        occurrence_count: 1
      };
      ledger.push(created);
      return emptyResult([
        {
          is_new: true,
          first_seen_workspace_id: created.first_seen_workspace_id,
          first_seen_at: created.first_seen_at
        }
      ]);
    },

    transition_workspace_subscription: (args, database) => {
      const status = String(args.trusted_new_status);
      if (!["incomplete", "trialing", "active", "past_due", "canceled"].includes(status)) {
        return {
          data: null,
          error: { code: "P0001", message: "invalid subscription status" },
          count: null
        };
      }
      const subscription = database
        .rows("workspace_subscriptions")
        .find((row) => String(row.workspace_id) === String(args.trusted_workspace_id));
      if (!subscription) return emptyResult(false);
      subscription.status = status;
      subscription.plan_id = args.trusted_plan_id ?? subscription.plan_id ?? null;
      subscription.trial_ends_at = args.trusted_trial_ends_at ?? null;
      subscription.current_period_ends_at = args.trusted_current_period_ends_at ?? null;
      if (status === "canceled") subscription.canceled_at = new Date().toISOString();
      subscription.updated_at = new Date().toISOString();
      return emptyResult(true);
    },

    ingest_billing_webhook_event: (args, database) => {
      const attempt = database
        .rows("billing_charge_attempts")
        .find((row) => String(row.id) === String(args.p_charge_attempt_id));
      if (!attempt) {
        return emptyResult([
          { result: "unknown_charge_attempt", webhook_event_id: null, trusted_workspace_id: null }
        ]);
      }
      const events = database.rows("billing_webhook_events");
      const duplicate = events.find(
        (row) =>
          String(row.provider) === String(args.p_provider) &&
          String(row.provider_event_ref) === String(args.p_provider_event_ref)
      );
      if (duplicate) {
        return emptyResult([
          {
            result: "duplicate",
            webhook_event_id: null,
            trusted_workspace_id: attempt.workspace_id ?? null
          }
        ]);
      }
      const id = database.nextId();
      events.push({
        id,
        workspace_id: attempt.workspace_id,
        provider: args.p_provider,
        provider_event_ref: args.p_provider_event_ref,
        event_type: args.p_event_type,
        safe_payload: args.p_safe_payload ?? {},
        occurred_at: args.p_occurred_at,
        processing_status: "accepted"
      });
      database.rows("billing_provider_event_outbox").push({
        id: database.nextId(),
        workspace_id: attempt.workspace_id,
        webhook_event_id: id,
        event_name: "billing/webhook.received",
        payload: {
          webhookEventId: id,
          trustedWorkspaceId: attempt.workspace_id,
          chargeAttemptId: attempt.id,
          provider: args.p_provider,
          providerEventRef: args.p_provider_event_ref
        },
        emitted_at: null,
        attempts: 0
      });
      return emptyResult([
        { result: "accepted", webhook_event_id: id, trusted_workspace_id: attempt.workspace_id }
      ]);
    }
  };
}

export type FakeSupabase = Readonly<{
  database: FakeDatabase;
  client: SupabaseClient;
}>;

export function createFakeSupabase(
  options: Readonly<{
    tables?: Readonly<Record<string, readonly FakeRow[]>>;
    rpc?: Readonly<Record<string, FakeRpcHandler>>;
    users?: Readonly<Record<string, { id: string; email: string }>>;
    currentUserId?: string;
  }> = {}
): FakeSupabase {
  const database = new FakeDatabase(options.tables ?? {});
  const handlers = { ...billingRpcHandlers(), ...(options.rpc ?? {}) };
  const users = options.users ?? {};

  const client = {
    from(table: string) {
      return new FakeQuery(database, table);
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      database.rpcCalls.push({ name, args: { ...args } });
      const handler = handlers[name];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: `Fake Supabase has no RPC "${name}".` },
          count: null
        });
      }
      return Promise.resolve(handler(args, database));
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: options.currentUserId ? { id: options.currentUserId } : null
          },
          error: null
        }),
      admin: {
        getUserById: (id: string) => {
          const user = users[id];
          if (!user) {
            return Promise.resolve({
              data: { user: null },
              error: { code: "404", message: "User not found." }
            });
          }
          return Promise.resolve({ data: { user }, error: null });
        }
      }
    }
  };

  return { database, client: client as unknown as SupabaseClient };
}
