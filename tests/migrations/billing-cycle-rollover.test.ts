import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises `ensure_open_billing_cycle` against a real engine.
 *
 * The ledger has required a cycle since it was created and nothing made one, so
 * no usage could be recorded at all. What this function has to get right is
 * narrow and unforgiving: exactly one open cycle per workspace, a new one when
 * the old window elapses, and the same answer when two turns ask at once.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;

async function newWorkspace(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.workspaces (name) values ($1) returning id",
    [name]
  );
  return result.rows[0]!.id;
}

async function ensureCycle(workspace: string): Promise<string> {
  const result = await db.query<{ ensure_open_billing_cycle: string }>(
    "select public.ensure_open_billing_cycle($1)",
    [workspace]
  );
  return result.rows[0]!.ensure_open_billing_cycle;
}

async function openCycles(workspace: string) {
  const result = await db.query<{ id: string; plan: string; catalogue_version: string }>(
    "select id, plan, catalogue_version from public.billing_cycles where workspace_id = $1 and closed_at is null",
    [workspace]
  );
  return result.rows;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(platformStub, "utf8"));
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`${migrationsDir}/${file}`, "utf8").replace(
        /create extension if not exists pgcrypto[^;]*;/gi,
        ""
      )
    );
  }
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("ensure_open_billing_cycle", () => {
  it("opens one cycle and returns the same one on the next call", async () => {
    const workspace = await newWorkspace("cycle-stable");
    const first = await ensureCycle(workspace);
    const second = await ensureCycle(workspace);
    expect(second).toBe(first);
    expect(await openCycles(workspace)).toHaveLength(1);
  });

  it("labels the cycle with the tier and catalogue the workspace is on", async () => {
    // The row records what this window was priced under. A cycle repriced
    // against a later catalogue is a cycle whose invoice cannot be explained.
    const workspace = await newWorkspace("cycle-labelled");
    await ensureCycle(workspace);
    const [cycle] = await openCycles(workspace);
    // Provisioning puts every new workspace on the Growth trial.
    expect(cycle?.plan).toBe("growth");
    expect(cycle?.catalogue_version).toBe("2026-09-v2");
  });

  it("closes an elapsed cycle and opens its successor", async () => {
    const workspace = await newWorkspace("cycle-rollover");
    const first = await ensureCycle(workspace);
    await db.query(
      // Both ends move: `billing_cycles_period_ordered` requires ends_at to
      // stay after started_at, so an elapsed window is one that began earlier
      // still.
      `update public.billing_cycles
          set started_at = now() - interval '2 months', ends_at = now() - interval '1 day'
        where id = $1`,
      [first]
    );

    const second = await ensureCycle(workspace);

    expect(second).not.toBe(first);
    expect(await openCycles(workspace)).toHaveLength(1);
    const closed = await db.query<{ closed_at: string | null }>(
      "select closed_at from public.billing_cycles where id = $1",
      [first]
    );
    // Never reopened: its rows are what an invoice for that window was
    // explained by.
    expect(closed.rows[0]!.closed_at).not.toBeNull();
  });

  it("keeps a cycle's ledger rows attached to the cycle that closed", async () => {
    const workspace = await newWorkspace("cycle-history");
    const first = await ensureCycle(workspace);
    await db.query(
      `insert into public.usage_ledger
         (workspace_id, billing_cycle_id, meter, quantity, idempotency_key)
       values ($1, $2, 'ai_work_units', 4, 'wu:history')`,
      [workspace, first]
    );
    await db.query(
      // Both ends move: `billing_cycles_period_ordered` requires ends_at to
      // stay after started_at, so an elapsed window is one that began earlier
      // still.
      `update public.billing_cycles
          set started_at = now() - interval '2 months', ends_at = now() - interval '1 day'
        where id = $1`,
      [first]
    );
    await ensureCycle(workspace);

    const totals = await db.query<{ total: string }>(
      "select total from public.usage_totals_for_cycle($1, $2) where meter = 'ai_work_units'",
      [workspace, first]
    );
    expect(Number(totals.rows[0]!.total)).toBe(4);
  });

  it("returns one id when two turns ask at the same moment", async () => {
    // `billing_cycles_one_open` is what makes this safe, and a read-then-insert
    // in the application would lose this race by construction. Two would
    // double-count every meter.
    const workspace = await newWorkspace("cycle-race");
    const ids = await Promise.all([
      ensureCycle(workspace),
      ensureCycle(workspace),
      ensureCycle(workspace)
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(await openCycles(workspace)).toHaveLength(1);
  });

  it("is not callable by a member", async () => {
    const granted = await db.query<{ has: boolean }>(
      "select has_function_privilege('authenticated', 'public.ensure_open_billing_cycle(uuid)', 'execute') as has"
    );
    expect(granted.rows[0]!.has).toBe(false);
  });
});
