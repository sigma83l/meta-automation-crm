import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A newly provisioned workspace must be able to use the product.
 *
 * This is the regression test for the bug that surfaced during the Frankfurt
 * cutover: the provisioning trigger left every workspace at 'incomplete', while
 * every paid-feature runtime resolves through resolveEntitledWorkspace, which
 * admits only 'trialing' or 'active'. Onboarding therefore failed on its first
 * save, reporting nothing more useful than "Save failed".
 *
 * It ran on the full migration chain rather than one file, because the property
 * under test spans two phases - the trigger lives in the billing migration and
 * the fix in a later one - and testing either alone would prove nothing about
 * what a workspace actually gets.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const stubPath = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;

async function newWorkspace(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.workspaces (name) values ($1) returning id",
    [name]
  );
  return result.rows[0]!.id;
}

async function subscription(workspaceId: string) {
  const result = await db.query<{
    status: string;
    trial_ends_at: string | null;
    trial_consumed_at: string | null;
  }>(
    `select status, trial_ends_at, trial_consumed_at
       from public.workspace_subscriptions where workspace_id = $1`,
    [workspaceId]
  );
  return result.rows[0]!;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(stubPath, "utf8"));
  for (const name of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`${migrationsDir}/${name}`, "utf8").replace(
        /create extension if not exists pgcrypto[^;]*;/gi,
        ""
      )
    );
  }
});

afterAll(async () => {
  await db?.close();
});

describe("a new workspace can actually use the product", () => {
  it("starts trialing rather than incomplete", async () => {
    // 'incomplete' fails the entitlement gate, so onboarding cannot save.
    const id = await newWorkspace("fresh");
    expect((await subscription(id)).status).toBe("trialing");
  });

  it("gets a trial end date in the future", async () => {
    // A 'trialing' row with a null end date fails the gate just as hard as
    // 'incomplete' — authorizeWorkspaceEntitlement requires both.
    const id = await newWorkspace("dated");
    const row = await subscription(id);
    expect(row.trial_ends_at).not.toBeNull();
    expect(Date.parse(row.trial_ends_at!)).toBeGreaterThan(Date.now());
  });

  it("gets seven days, as the pack specifies", async () => {
    const id = await newWorkspace("seven");
    const row = await subscription(id);
    const days = (Date.parse(row.trial_ends_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("needs no card to get it", async () => {
    // The pack is explicit: 7 days, no card, no auto-charge. Nothing about
    // provisioning may consult a payment method.
    const id = await newWorkspace("cardless");
    const cards = await db.query<{ count: string }>(
      "select count(*) as count from public.billing_payment_methods where workspace_id = $1",
      [id]
    );
    expect(Number(cards.rows[0]!.count)).toBe(0);
    expect((await subscription(id)).status).toBe("trialing");
  });
});

describe("the trial cannot be taken twice", () => {
  it("stamps trial_consumed_at when the trial is granted", async () => {
    // Never cleared afterwards, which is what stops a cancelled workspace
    // coming back around for a second free window.
    const id = await newWorkspace("consumed");
    expect((await subscription(id)).trial_consumed_at).not.toBeNull();
  });

  it("leaves a cancelled workspace alone rather than re-trialing it", async () => {
    const id = await newWorkspace("cancelled");
    await db.query(
      `update public.workspace_subscriptions
          set status = 'canceled', trial_ends_at = now() - interval '1 day'
        where workspace_id = $1`,
      [id]
    );
    // Re-running the backfill predicate must not touch it: it has consumed a
    // trial, so it is excluded by trial_consumed_at.
    await db.query(
      `update public.workspace_subscriptions
          set status = 'trialing', trial_ends_at = now() + interval '7 days'
        where status = 'incomplete' and trial_consumed_at is null`
    );
    expect((await subscription(id)).status).toBe("canceled");
  });
});

describe("the backfill is narrow", () => {
  it("rescues a workspace stranded at incomplete", async () => {
    // The state the live workspace was found in after the region cutover.
    const id = await newWorkspace("stranded");
    await db.query(
      `update public.workspace_subscriptions
          set status = 'incomplete', trial_ends_at = null, trial_consumed_at = null
        where workspace_id = $1`,
      [id]
    );
    await db.query(
      `update public.workspace_subscriptions
          set status = 'trialing', trial_ends_at = now() + interval '7 days',
              trial_consumed_at = now()
        where status = 'incomplete' and trial_consumed_at is null`
    );
    const row = await subscription(id);
    expect(row.status).toBe("trialing");
    expect(Date.parse(row.trial_ends_at!)).toBeGreaterThan(Date.now());
  });
});
