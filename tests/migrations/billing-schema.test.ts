import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Executes the billing migration against a real PostgreSQL engine.
 *
 * PGlite is Postgres compiled to WASM and runs in-process, so this needs no
 * Docker, no daemon and no privileges — which matters because the SQL in this
 * repo is otherwise only exercisable on a machine with a working local Supabase
 * stack. TypeScript checks none of it, so without this the plpgsql, the
 * constraints and the privilege model ship unverified.
 *
 * This is not a substitute for the pgTAP suite: there is no PostgREST here and
 * no Supabase auth, so RLS *policy* evaluation against a real JWT still belongs
 * in `supabase/tests/database`. What this covers is everything the engine owns —
 * DDL, constraints, plpgsql control flow, and the grant layer.
 */

const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260730010000_billing_subscriptions.sql", import.meta.url)
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

async function transition(
  id: string,
  status: string,
  options: { trialEndsAt?: string | null; periodEndsAt?: string | null } = {}
) {
  const result = await db.query<{ ok: boolean }>(
    "select public.transition_workspace_subscription($1,$2,null,$3,$4) as ok",
    [id, status, options.trialEndsAt ?? null, options.periodEndsAt ?? null]
  );
  return result.rows[0]!.ok;
}

async function subscription(id: string) {
  const result = await db.query<{
    status: string;
    trial_ends_at: string | null;
    trial_consumed_at: string | null;
  }>(
    `select status, trial_ends_at, trial_consumed_at
       from public.workspace_subscriptions where workspace_id = $1`,
    [id]
  );
  return result.rows[0]!;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(preludePath, "utf8"));
  await db.exec(readFileSync(migrationPath, "utf8"));
  // The migration seeds its own default plan, which the workspace trigger
  // attaches to every new subscription.
  workspaceId = await newWorkspace("acme");
});

afterAll(async () => {
  await db?.close();
});

describe("billing migration applies", () => {
  it("enables and forces row level security on every billing table", async () => {
    const result = await db.query<{ relname: string; ok: boolean }>(
      `select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (c.relname like 'billing%' or c.relname = 'workspace_subscriptions')`
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) expect(`${row.relname}:${row.ok}`).toBe(`${row.relname}:true`);
  });
});

describe("subscription state machine", () => {
  it("starts a trial and stamps the workspace trial ledger", async () => {
    expect(await transition(workspaceId, "trialing", { trialEndsAt: "2026-08-21T00:00:00Z" })).toBe(
      true
    );
    const row = await subscription(workspaceId);
    expect(row.status).toBe("trialing");
    expect(row.trial_consumed_at).not.toBeNull();
  });

  it("refuses to extend a trial that is already running", async () => {
    await expect(
      transition(workspaceId, "trialing", { trialEndsAt: "2026-09-30T00:00:00Z" })
    ).rejects.toThrow(/already consumed/);
  });

  it("clears the trial end when a charge converts the subscription", async () => {
    // Carrying a past trial end forward left the subscription permanently due,
    // which re-charged the customer on every tick.
    expect(await transition(workspaceId, "active", { periodEndsAt: "2026-09-13T00:00:00Z" })).toBe(
      true
    );
    const row = await subscription(workspaceId);
    expect(row.status).toBe("active");
    expect(row.trial_ends_at).toBeNull();
  });

  it("refuses a second trial after cancellation, even with a different card", async () => {
    // The abuse path: cancel, present another card, receive a fresh window,
    // repeat indefinitely. Card-fingerprint checks alone did not close it.
    expect(await transition(workspaceId, "past_due")).toBe(true);
    expect(await transition(workspaceId, "canceled")).toBe(true);
    await expect(
      transition(workspaceId, "trialing", { trialEndsAt: "2026-12-31T00:00:00Z" })
    ).rejects.toThrow(/already consumed/);
  });

  it("still lets a cancelled customer re-subscribe by paying", async () => {
    expect(await transition(workspaceId, "active", { periodEndsAt: "2026-10-13T00:00:00Z" })).toBe(
      true
    );
  });

  it("refuses a transition back to the initial state", async () => {
    await expect(transition(workspaceId, "incomplete")).rejects.toThrow(/illegal subscription/);
  });

  it("does not penalise a workspace that has never trialed", async () => {
    const fresh = await newWorkspace("beta");
    expect(await transition(fresh, "trialing", { trialEndsAt: "2026-08-25T00:00:00Z" })).toBe(true);
  });
});

describe("card registration sessions", () => {
  const claim = `update public.billing_card_registration_sessions
                    set status='processing', updated_at=now()
                  where workspace_id=$1 and status='pending' and expires_at >= now()
                 returning id`;

  it("can be claimed exactly once", async () => {
    const id = await newWorkspace("claimant");
    await db.query(
      `insert into public.billing_card_registration_sessions
         (workspace_id, provider, provider_session_ref, status, expires_at)
       values ($1,'paytr','order-claim-1','pending', now() + interval '30 minutes')`,
      [id]
    );
    expect((await db.query(claim, [id])).rows).toHaveLength(1);
    expect((await db.query(claim, [id])).rows).toHaveLength(0);
  });

  it("cannot be claimed once expired", async () => {
    const id = await newWorkspace("stale");
    await db.query(
      `insert into public.billing_card_registration_sessions
         (workspace_id, provider, provider_session_ref, status, expires_at)
       values ($1,'paytr','order-claim-2','pending', now() - interval '1 minute')`,
      [id]
    );
    expect((await db.query(claim, [id])).rows).toHaveLength(0);
  });
});

describe("webhook provider constraint", () => {
  it("accepts the synthetic provider so the local path is exercisable", async () => {
    await expect(
      db.query(
        `insert into public.billing_webhook_events
           (workspace_id, provider, provider_event_ref, event_type, occurred_at)
         values ($1,'fake','evt-fake-1','charge.succeeded', now())`,
        [workspaceId]
      )
    ).resolves.toBeDefined();
  });

  it("still rejects an unrecognised provider", async () => {
    await expect(
      db.query(
        `insert into public.billing_webhook_events
           (workspace_id, provider, provider_event_ref, event_type, occurred_at)
         values ($1,'stripe','evt-bogus','charge.succeeded', now())`,
        [workspaceId]
      )
    ).rejects.toThrow();
  });
});

describe("privilege layer", () => {
  it.each([
    "provider_customer_ref_ciphertext",
    "provider_card_ref_ciphertext",
    "provider_customer_ref_iv",
    "provider_card_ref_auth_tag"
  ])("hides %s from the browser role at the privilege layer, not just RLS", async (column) => {
    const result = await db.query<{ granted: boolean }>(
      `select has_column_privilege('authenticated','public.billing_payment_methods',$1,'SELECT') as granted`,
      [column]
    );
    expect(result.rows[0]!.granted).toBe(false);
  });

  it("still exposes the masked card suffix", async () => {
    const result = await db.query<{ granted: boolean }>(
      `select has_column_privilege('authenticated','public.billing_payment_methods','masked_card_suffix','SELECT') as granted`
    );
    expect(result.rows[0]!.granted).toBe(true);
  });

  it.each(["billing_card_registration_sessions", "billing_provider_event_outbox"])(
    "gives the browser role no access to %s at all",
    async (table) => {
      const result = await db.query<{ granted: boolean }>(
        `select has_table_privilege('authenticated',$1,'SELECT') as granted`,
        [`public.${table}`]
      );
      expect(result.rows[0]!.granted).toBe(false);
    }
  );

  it("keeps the trial fingerprint ledger entirely private", async () => {
    const result = await db.query<{ granted: boolean }>(
      `select has_table_privilege('authenticated','private.trial_fraud_signals','SELECT') as granted`
    );
    expect(result.rows[0]!.granted).toBe(false);
  });
});
