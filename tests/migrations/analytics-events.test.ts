import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the analytics ledgers against a real PostgreSQL engine.
 *
 * The properties worth proving here are the ones the database owns alone: the
 * append-only triggers, the idempotency index that stops a redelivered webhook
 * inflating a funnel, the size ceiling that makes smuggling a message body into
 * a property value fail rather than succeed quietly, and the constraint that no
 * event may be attributable to nothing at all.
 */

const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260816130000_analytics_events.sql", import.meta.url)
);
const preludePath = fileURLToPath(new URL("./prelude.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;

async function newWorkspace(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.workspaces (name) values ($1) returning id",
    [name]
  );
  return result.rows[0]!.id;
}

async function recordEvent(
  options: {
    workspace?: string | null;
    name?: string;
    group?: string;
    anonymousId?: string | null;
    idempotencyKey?: string | null;
    properties?: Record<string, unknown>;
  } = {}
) {
  await db.query(
    `insert into public.analytics_events
       (workspace_id, event_name, event_group, anonymous_id, idempotency_key, properties)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      options.workspace === undefined ? workspaceId : options.workspace,
      options.name ?? "workspace.provisioned",
      options.group ?? "activation",
      options.anonymousId ?? null,
      options.idempotencyKey ?? null,
      JSON.stringify(options.properties ?? {})
    ]
  );
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(preludePath, "utf8"));
  await db.exec(readFileSync(migrationPath, "utf8"));
  workspaceId = await newWorkspace("acme");
});

afterAll(async () => {
  await db?.close();
});

describe("the event ledger is append-only", () => {
  it("accepts an event", async () => {
    await recordEvent({ idempotencyKey: "prov:1" });
    const result = await db.query<{ count: string }>(
      "select count(*) as count from public.analytics_events"
    );
    expect(Number(result.rows[0]!.count)).toBe(1);
  });

  it("refuses an update", async () => {
    // A funnel computed from mutable rows cannot be defended.
    await expect(
      db.query("update public.analytics_events set event_name = 'trial.started'")
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    await expect(db.query("delete from public.analytics_events")).rejects.toThrow(/append-only/);
  });

  it("holds the same rule for agent runs", async () => {
    // A telemetry trail that can be edited is worthless in an incident review.
    await db.query(
      `insert into public.agent_runs (workspace_id, provider, model_role, model_id)
       values ($1, 'anthropic', 'primary', 'model-under-test')`,
      [workspaceId]
    );
    await expect(db.query("update public.agent_runs set retry_count = 5")).rejects.toThrow(
      /append-only/
    );
    await expect(db.query("delete from public.agent_runs")).rejects.toThrow(/append-only/);
  });
});

describe("redelivery never inflates a funnel", () => {
  it("refuses a repeated idempotency key for the same event", async () => {
    await recordEvent({ name: "trial.started", group: "billing", idempotencyKey: "trial:1" });
    await expect(
      recordEvent({ name: "trial.started", group: "billing", idempotencyKey: "trial:1" })
    ).rejects.toThrow(/duplicate key/i);
  });

  it("allows the same key for a different event name", async () => {
    await expect(
      recordEvent({ name: "trial.expired", group: "billing", idempotencyKey: "trial:1" })
    ).resolves.toBeUndefined();
  });

  it("allows repeated events with no key at all", async () => {
    // Not every event has a natural key; a page view is genuinely repeatable.
    await recordEvent({ name: "cta_clicked", group: "acquisition" });
    await expect(
      recordEvent({ name: "cta_clicked", group: "acquisition" })
    ).resolves.toBeUndefined();
  });
});

describe("an event always belongs to somebody", () => {
  it("accepts an anonymous pre-signup event", async () => {
    // Acquisition events happen before a workspace exists.
    await expect(
      recordEvent({
        workspace: null,
        name: "marketing.page_viewed",
        group: "acquisition",
        anonymousId: "anon_0123456789"
      })
    ).resolves.toBeUndefined();
  });

  it("refuses an event with neither a workspace nor a visitor", async () => {
    // Otherwise the row is attributable to nothing at all.
    await expect(
      recordEvent({ workspace: null, name: "cta_clicked", group: "acquisition" })
    ).rejects.toThrow(/analytics_events_has_subject/);
  });

  it("refuses an unknown event group", async () => {
    await expect(recordEvent({ group: "vanity" })).rejects.toThrow(/event_group/);
  });
});

describe("properties cannot carry a conversation", () => {
  it("accepts ordinary dimensions and measures", async () => {
    await expect(
      recordEvent({
        name: "channel.connected",
        group: "activation",
        properties: { channel: "whatsapp", count: 1 }
      })
    ).resolves.toBeUndefined();
  });

  it("refuses a property blob big enough to hold a transcript", async () => {
    // The application boundary is the real defence; this is the backstop that
    // makes smuggling a message body fail rather than succeed quietly.
    await expect(
      recordEvent({
        name: "send.failed",
        group: "reliability",
        properties: { note: "x".repeat(6000) }
      })
    ).rejects.toThrow(/properties/);
  });
});

describe("tenant isolation", () => {
  it("forces row level security on both ledgers", async () => {
    const result = await db.query<{ relname: string; ok: boolean }>(
      `select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('analytics_events', 'agent_runs')`
    );
    expect(result.rows.length).toBe(2);
    for (const row of result.rows) expect(`${row.relname}:${row.ok}`).toBe(`${row.relname}:true`);
  });

  it("lets members read but never write either ledger", async () => {
    for (const table of ["analytics_events", "agent_runs"]) {
      const result = await db.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_name = $1 and grantee = 'authenticated'`,
        [table]
      );
      expect(`${table}:${result.rows.map((row) => row.privilege_type).join(",")}`).toBe(
        `${table}:SELECT`
      );
    }
  });

  it("gives service_role no way to rewrite history", async () => {
    const result = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'analytics_events' and grantee = 'service_role'`
    );
    expect(result.rows.map((row) => row.privilege_type).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("keeps anonymous rows unreadable through the member policy", async () => {
    // One workspace must never be able to enumerate visitors who later joined
    // another, so the policy requires a workspace and anonymous rows have none.
    const result = await db.query<{ qual: string }>(
      `select pg_get_expr(polqual, polrelid) as qual
         from pg_policy where polname = 'analytics_events_select_member'`
    );
    expect(result.rows[0]!.qual).toContain("workspace_id IS NOT NULL");
  });
});

describe("the daily read model is derived", () => {
  it("aggregates the ledger by day, group and name", async () => {
    const result = await db.query<{ event_name: string; event_count: string }>(
      `select event_name, event_count from public.analytics_daily_view
        where workspace_id = $1 and event_name = 'cta_clicked'`,
      [workspaceId]
    );
    expect(Number(result.rows[0]!.event_count)).toBe(2);
  });

  it("leaves anonymous events out of workspace aggregates", async () => {
    const result = await db.query<{ count: string }>(
      `select count(*) as count from public.analytics_daily_view where workspace_id is null`
    );
    expect(Number(result.rows[0]!.count)).toBe(0);
  });
});
