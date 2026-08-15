import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * Replays every migration, in order, against a real PostgreSQL engine.
 *
 * Migrations here are forward-only and are the sole definition of the schema, so
 * the chain has to apply cleanly from nothing. Nothing else checks that: unit
 * tests never touch SQL, and the Supabase suite needs Docker, which not every
 * machine has. A migration that only works because of state left by an earlier
 * hand-run would pass everything else and fail on a fresh environment.
 *
 * This also gives a trustworthy answer to "what should the database contain?",
 * which is what makes a drift comparison against a live project meaningful.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function replayAll(): Promise<{ db: PGlite; applied: string[] }> {
  const db = await PGlite.create();
  await db.exec(readFileSync(platformStub, "utf8"));
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    // See platform-stub.sql: pgcrypto is declared but unused beyond
    // gen_random_uuid(), which is core.
    const sql = readFileSync(`${migrationsDir}/${file}`, "utf8").replace(
      /create extension if not exists pgcrypto[^;]*;/gi,
      ""
    );
    await db.exec(sql);
    applied.push(file);
  }
  return { db, applied };
}

describe("migration chain", () => {
  it("applies every migration in order against a fresh database", async () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    const { db, applied } = await replayAll();
    try {
      expect(applied).toEqual(files);
    } finally {
      await db.close();
    }
  });

  it("produces the tenant tables the application depends on", async () => {
    const { db } = await replayAll();
    try {
      const rows = await db.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'"
      );
      const tables = new Set(rows.rows.map((row) => row.tablename));
      // A representative slice across every domain, so a migration silently
      // dropping one is caught rather than discovered in production.
      for (const required of [
        "workspaces",
        "workspace_memberships",
        "profiles",
        "onboarding_states",
        "customers",
        "conversations",
        "messages",
        "meta_connections",
        "meta_webhook_events",
        "automations",
        "automation_runs",
        "workspace_subscriptions",
        "billing_charge_attempts"
      ]) {
        expect(`${required}:${tables.has(required)}`).toBe(`${required}:true`);
      }
    } finally {
      await db.close();
    }
  });

  it("indexes workspace_id on every tenant table the browser can read", async () => {
    // Each such table is filtered by is_active_member(workspace_id) on every
    // authenticated read, so without a workspace-leading index the RLS check
    // alone forces a sequential scan.
    const { db } = await replayAll();
    try {
      const rows = await db.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and has_table_privilege('authenticated', 'public.' || c.relname, 'SELECT')
            and exists (
              select 1 from information_schema.columns col
               where col.table_schema = 'public'
                 and col.table_name = c.relname
                 and col.column_name = 'workspace_id')
            and not exists (
              select 1 from pg_index i
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
               where i.indrelid = c.oid and a.attname = 'workspace_id')`
      );
      expect(rows.rows.map((row) => row.relname)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("leaves no tenant table without row level security forced", async () => {
    const { db } = await replayAll();
    try {
      const rows = await db.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and c.relname like any (array['workspace%','customer%','billing%','meta_%','automation%'])
            and not (c.relrowsecurity and c.relforcerowsecurity)`
      );
      expect(rows.rows.map((row) => row.relname)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
