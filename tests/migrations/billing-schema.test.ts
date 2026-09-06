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

// Billing schema plus the lifecycle migration that extends its state machine.
// Applied in order, because the later one redefines the transition function.
const migrationPaths = [
  "20260730010000_billing_subscriptions.sql",
  "20260815130000_account_lifecycle_states.sql",
  // Repairs check_and_record_trial_fingerprint, which the first migration
  // defined with an ambiguous RETURNING clause.
  "20260905000000_fix_trial_fingerprint_ambiguity.sql"
].map((name) => fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)));
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
  options: {
    trialEndsAt?: string | null;
    periodEndsAt?: string | null;
    graceEndsAt?: string | null;
  } = {}
) {
  const result = await db.query<{ ok: boolean }>(
    "select public.transition_workspace_subscription($1,$2,null,$3,$4,$5) as ok",
    [
      id,
      status,
      options.trialEndsAt ?? null,
      options.periodEndsAt ?? null,
      options.graceEndsAt ?? null
    ]
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
  for (const path of migrationPaths) await db.exec(readFileSync(path, "utf8"));
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

describe("lapsed trial lifecycle", () => {
  let lapsing: string;

  it("moves a trial into grace and records the deadline", async () => {
    lapsing = await newWorkspace("lapsing");
    expect(await transition(lapsing, "trialing", { trialEndsAt: "2026-08-20T00:00:00Z" })).toBe(
      true
    );
    expect(
      await transition(lapsing, "trial_expired_grace", {
        graceEndsAt: "2026-08-23T00:00:00Z"
      })
    ).toBe(true);
    const row = await db.query<{ status: string; grace_ends_at: string | null }>(
      "select status, grace_ends_at from public.workspace_subscriptions where workspace_id = $1",
      [lapsing]
    );
    expect(row.rows[0]!.status).toBe("trial_expired_grace");
    expect(row.rows[0]!.grace_ends_at).not.toBeNull();
  });

  it("refuses to re-enter grace, which would extend the window indefinitely", async () => {
    await expect(
      transition(lapsing, "trial_expired_grace", { graceEndsAt: "2026-09-30T00:00:00Z" })
    ).rejects.toThrow(/illegal subscription transition/);
  });

  it("lets a workspace escape grace by paying", async () => {
    expect(await transition(lapsing, "active", { periodEndsAt: "2026-09-23T00:00:00Z" })).toBe(
      true
    );
    const row = await db.query<{ grace_ends_at: string | null }>(
      "select grace_ends_at from public.workspace_subscriptions where workspace_id = $1",
      [lapsing]
    );
    // A stale deadline must not survive; it could otherwise re-close later.
    expect(row.rows[0]!.grace_ends_at).toBeNull();
  });

  it("refuses grace for anything that was never trialing", async () => {
    const paid = await newWorkspace("never-trialed");
    expect(await transition(paid, "active", { periodEndsAt: "2026-09-23T00:00:00Z" })).toBe(true);
    await expect(
      transition(paid, "trial_expired_grace", { graceEndsAt: "2026-09-30T00:00:00Z" })
    ).rejects.toThrow(/illegal subscription transition/);
  });
});

describe("suspension", () => {
  it("can suspend from any live status and reinstate", async () => {
    const ws = await newWorkspace("suspendable");
    expect(await transition(ws, "active", { periodEndsAt: "2026-09-23T00:00:00Z" })).toBe(true);
    expect(await transition(ws, "suspended")).toBe(true);
    // Recoverable by design: suspension withdraws access, it does not end the
    // relationship the way cancellation does.
    expect(await transition(ws, "active", { periodEndsAt: "2026-10-23T00:00:00Z" })).toBe(true);
  });

  it("still refuses a second trial after suspension", async () => {
    const ws = await newWorkspace("suspended-trialer");
    expect(await transition(ws, "trialing", { trialEndsAt: "2026-08-20T00:00:00Z" })).toBe(true);
    expect(await transition(ws, "suspended")).toBe(true);
    await expect(
      transition(ws, "trialing", { trialEndsAt: "2026-12-01T00:00:00Z" })
    ).rejects.toThrow(/already consumed/);
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

/**
 * The trial fingerprint ledger.
 *
 * This function shipped unable to run at all: its OUT parameters are named
 * `first_seen_workspace_id` and `first_seen_at`, and the inserting CTE returned
 * columns of those names unqualified, so every call was rejected with 42702
 * before a row was touched. Nothing caught it, because the only caller is card
 * registration - trials are granted at provisioning without a card - and the
 * failure surfaced to a person as "Something went wrong. Please try again."
 *
 * So the first assertion here is simply that calling it works. The rest pin the
 * behaviour that made it worth having.
 */
describe("check_and_record_trial_fingerprint", () => {
  const hash = (seed: string) => seed.repeat(64).slice(0, 64);

  it("records a fingerprint it has not seen, and says it is new", async () => {
    const workspace = await newWorkspace("fingerprint-first");
    const result = await db.query<{
      is_new: boolean;
      first_seen_workspace_id: string;
    }>("select * from public.check_and_record_trial_fingerprint($1, $2)", [hash("a"), workspace]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.is_new).toBe(true);
    expect(result.rows[0]!.first_seen_workspace_id).toBe(workspace);
  });

  it("reports a card that already claimed a trial, and keeps the first claimant", async () => {
    const first = await newWorkspace("fingerprint-owner");
    const second = await newWorkspace("fingerprint-repeat");
    await db.query("select * from public.check_and_record_trial_fingerprint($1, $2)", [
      hash("b"),
      first
    ]);

    const repeat = await db.query<{
      is_new: boolean;
      first_seen_workspace_id: string;
    }>("select * from public.check_and_record_trial_fingerprint($1, $2)", [hash("b"), second]);

    expect(repeat.rows[0]!.is_new).toBe(false);
    // The point of the ledger: the card belongs to whoever presented it first,
    // so a second workspace cannot inherit a trial by presenting the same card.
    expect(repeat.rows[0]!.first_seen_workspace_id).toBe(first);
  });

  it("counts repeat presentations of the same card", async () => {
    const workspace = await newWorkspace("fingerprint-counted");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await db.query("select * from public.check_and_record_trial_fingerprint($1, $2)", [
        hash("c"),
        workspace
      ]);
    }
    const counted = await db.query<{ occurrence_count: number }>(
      "select occurrence_count from private.trial_fraud_signals where fingerprint_hash = $1",
      [hash("c")]
    );
    // One insert plus two bumps.
    expect(Number(counted.rows[0]!.occurrence_count)).toBe(3);
  });

  it("refuses anything that is not a sha256 digest", async () => {
    const workspace = await newWorkspace("fingerprint-invalid");
    await expect(
      db.query("select * from public.check_and_record_trial_fingerprint($1, $2)", [
        "not-a-digest",
        workspace
      ])
    ).rejects.toThrow(/invalid fingerprint hash/);
  });
});
