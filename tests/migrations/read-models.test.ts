import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the read models against a real PostgreSQL engine.
 *
 * These run on the full migration chain rather than a single file, because a
 * read model is by definition a join across tables owned by several phases —
 * that is the whole point of it, and testing one in isolation would test
 * nothing.
 *
 * The property that matters most is security_invoker. A view over tenant tables
 * that runs as its owner returns every workspace's rows to whoever queries it,
 * and it does so silently: the query succeeds, the numbers are simply somebody
 * else's. RLS cannot save a caller from a definer view, so this is asserted
 * directly against the catalog.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const stubPath = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

const READ_MODELS = [
  "workspace_overview_view",
  "contact_revenue_state_view",
  "usage_summary_view",
  "integration_health_view",
  "support_ticket_view",
  "analytics_daily_view"
] as const;

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(stubPath, "utf8"));
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    // Consume through the semicolon, as migration-chain.test.ts does: the
    // declaration is `create extension ... with schema extensions;`, and a
    // regex stopping at the extension name leaves the tail behind as a syntax
    // error. See platform-stub.sql — pgcrypto is unused beyond
    // gen_random_uuid(), which is core.
    const sql = readFileSync(`${migrationsDir}/${name}`, "utf8").replace(
      /create extension if not exists pgcrypto[^;]*;/gi,
      ""
    );
    await db.exec(sql);
  }
});

afterAll(async () => {
  await db?.close();
});

describe("every read model exists", () => {
  it("creates all six views", async () => {
    const result = await db.query<{ viewname: string }>(
      `select viewname from pg_views where schemaname = 'public'`
    );
    const present = result.rows.map((row) => row.viewname);
    for (const view of READ_MODELS) {
      expect(`${view}:${present.includes(view)}`).toBe(`${view}:true`);
    }
  });

  it("is queryable, which is what proves the joins resolve", async () => {
    // A view can be created against columns that do not exist in the shape the
    // author assumed; only selecting from it finds that out.
    for (const view of READ_MODELS) {
      await expect(db.query(`select * from public.${view} limit 1`)).resolves.toBeDefined();
    }
  });
});

describe("read models run as the caller, never as their owner", () => {
  it("sets security_invoker on every view", async () => {
    // A definer view over tenant tables returns every workspace's rows to
    // whoever queries it, and the query succeeds — the numbers are simply
    // somebody else's. RLS cannot save a caller from that.
    for (const view of READ_MODELS) {
      const result = await db.query<{ options: string[] | null }>(
        `select c.reloptions as options
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`,
        [view]
      );
      const options = result.rows[0]?.options ?? [];
      expect(`${view}:${options.includes("security_invoker=true")}`).toBe(`${view}:true`);
    }
  });

  it("grants read to authenticated and nothing more", async () => {
    for (const view of READ_MODELS) {
      const result = await db.query<{ privilege_type: string }>(
        `select distinct privilege_type from information_schema.role_table_grants
          where table_name = $1 and grantee = 'authenticated'`,
        [view]
      );
      expect(`${view}:${result.rows.map((row) => row.privilege_type).join(",")}`).toBe(
        `${view}:SELECT`
      );
    }
  });

  it("grants nothing to anon", async () => {
    const result = await db.query<{ count: string }>(
      `select count(*) as count from information_schema.role_table_grants
        where table_name = any($1) and grantee = 'anon'`,
      [[...READ_MODELS]]
    );
    expect(Number(result.rows[0]!.count)).toBe(0);
  });
});

describe("the read models keep P5's separation", () => {
  it("exposes lifecycle, status and score as three columns", async () => {
    // Merging them here would undo in SQL exactly what the schema kept apart.
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'contact_revenue_state_view'`
    );
    const columns = result.rows.map((row) => row.column_name);
    for (const column of ["lifecycle_stage", "lead_status", "qualification_score"]) {
      expect(`${column}:${columns.includes(column)}`).toBe(`${column}:true`);
    }
    // And no single collapsed column pretending to be all three.
    expect(columns).not.toContain("status");
  });

  it("carries a recovery action for every connection state", async () => {
    // A state nobody knows how to clear is a support ticket.
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'integration_health_view' and column_name = 'recovery_action'`
    );
    expect(result.rows).toHaveLength(1);
  });

  it("reports usage against the catalogue version the cycle was priced under", async () => {
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'usage_summary_view'`
    );
    const columns = result.rows.map((row) => row.column_name);
    expect(columns).toContain("catalogue_version");
    expect(columns).toContain("used");
  });
});

describe("read models are derived, never stored", () => {
  it("creates no materialized views", async () => {
    // A materialized view showing yesterday's figures as today's is wrong
    // silently, and the reader has no way to tell.
    const result = await db.query<{ matviewname: string }>(
      `select matviewname from pg_matviews where schemaname = 'public'`
    );
    expect(result.rows).toEqual([]);
  });
});
