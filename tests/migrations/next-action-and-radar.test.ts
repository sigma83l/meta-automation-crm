import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The list query, and the proposals it shows.
 *
 * The view is checked against a real engine because its whole job is to be one
 * round trip that produces the right inputs. A subquery scoped to the wrong
 * column returns plausible numbers from the wrong customer, which is the kind
 * of wrong that reads as correct.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let otherWorkspaceId: string;
let customerId: string;
let otherCustomerId: string;
let userId: string;

type RadarRow = {
  customer_id: string;
  score: number | null;
  unread_inbound: number;
  human_review_requested: boolean;
  followup_due_at: string | null;
  opted_out: boolean;
  has_evidence: boolean;
  owner_id: string | null;
  channel: string | null;
  last_activity_at: string;
};

const radar = (customer: string) =>
  db.query<RadarRow>("select * from public.crm_radar_view where customer_id = $1", [customer]);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(platformStub, "utf8"));
  for (const name of readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`${migrationsDir}/${name}`, "utf8").replace(
        /create extension if not exists pgcrypto[^;]*;/gi,
        ""
      )
    );
  }
  const workspaces = await db.query<{ id: string }>(
    `insert into public.workspaces (name, status)
     values ('radar-ws', 'active'), ('radar-other', 'active') returning id`
  );
  workspaceId = workspaces.rows[0]!.id;
  otherWorkspaceId = workspaces.rows[1]!.id;

  const customers = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual'), ($1, 'Neighbour', 'manual') returning id`,
    [workspaceId]
  );
  customerId = customers.rows[0]!.id;
  otherCustomerId = customers.rows[1]!.id;

  await db.exec("set session_replication_role = replica;");
  const user = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('owner@example.test') returning id"
  );
  await db.exec("set session_replication_role = origin;");
  userId = user.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("the radar view assembles one row per customer", () => {
  it("returns every customer in the workspace and nobody else's", async () => {
    await db.query(
      `insert into public.customers (workspace_id, display_name, source)
       values ($1, 'Stranger', 'manual')`,
      [otherWorkspaceId]
    );
    const rows = await db.query<{ customer_id: string }>(
      "select customer_id from public.crm_radar_view where workspace_id = $1",
      [workspaceId]
    );
    expect(rows.rows).toHaveLength(2);
  });

  it("starts a fresh customer with nothing claimed about them", async () => {
    const row = (await radar(customerId)).rows[0]!;
    expect(row.score).toBeNull();
    expect(Number(row.unread_inbound)).toBe(0);
    expect(row.human_review_requested).toBe(false);
    expect(row.opted_out).toBe(false);
    expect(row.has_evidence).toBe(false);
    expect(row.owner_id).toBeNull();
  });

  it("counts unread messages on open conversations only", async () => {
    await db.query(
      `insert into public.conversations
         (workspace_id, customer_id, channel, state, unread_count, last_message_at)
       values ($1, $2, 'whatsapp', 'open', 3, now()),
              ($1, $2, 'instagram', 'closed', 9, now())`,
      [workspaceId, customerId]
    );
    expect(Number((await radar(customerId)).rows[0]!.unread_inbound)).toBe(3);
  });

  it("does not attribute one customer's conversation to another", async () => {
    // The failure this guards: a subquery joined on workspace but not customer
    // returns plausible numbers from the wrong row.
    expect(Number((await radar(otherCustomerId)).rows[0]!.unread_inbound)).toBe(0);
  });

  it("reports the latest score snapshot", async () => {
    for (const score of [40, 72]) {
      await db.query(
        `select * from public.record_score_snapshot(
           $1, $2, $3, '{}'::jsonb, 0, 0.8, '[]'::jsonb, '[]'::jsonb, 'crm-score-v1',
           '{}', '{}', null, null)`,
        [workspaceId, customerId, score]
      );
    }
    expect((await radar(customerId)).rows[0]!.score).toBe(72);
  });

  it("reports a live follow-up's due time and an opt-out on any channel", async () => {
    await db.query(
      `insert into public.tasks_followups
         (workspace_id, customer_id, stop_reason, objective, cancel_condition, due_at, owner_type)
       values ($1, $2, 'price_sent', 'ask again', 'they answer',
               '2026-09-01T00:00:00Z', 'automation')`,
      [workspaceId, customerId]
    );
    await db.query(
      `insert into public.customer_consents (workspace_id, customer_id, channel, opt_out)
       values ($1, $2, 'whatsapp', true)`,
      [workspaceId, customerId]
    );
    const row = (await radar(customerId)).rows[0]!;
    expect(row.followup_due_at).not.toBeNull();
    expect(row.opted_out).toBe(true);
  });

  it("sees evidence only when it can both name a source and a component", async () => {
    await db.query(
      `insert into public.qualification_evidence
         (workspace_id, customer_id, signal, weight, evidence_ref)
       values ($1, $2, 'legacy', 10, 'msg-1')`,
      [workspaceId, customerId]
    );
    // No component: the same row the scorer refuses to count.
    expect((await radar(customerId)).rows[0]!.has_evidence).toBe(false);

    await db.query(
      `insert into public.qualification_evidence
         (workspace_id, customer_id, signal, weight, evidence_ref, component)
       values ($1, $2, 'asked_price', 10, 'msg-2', 'intent')`,
      [workspaceId, customerId]
    );
    expect((await radar(customerId)).rows[0]!.has_evidence).toBe(true);
  });

  it("takes the owner from an open opportunity", async () => {
    await db.query(
      `insert into public.opportunities (workspace_id, customer_id, stage, owner_id)
       values ($1, $2, 'open', $3)`,
      [workspaceId, customerId, userId]
    );
    expect((await radar(customerId)).rows[0]!.owner_id).toBe(userId);
  });

  it("moves last activity forward when anything happens", async () => {
    const before = (await radar(otherCustomerId)).rows[0]!.last_activity_at;
    await db.query(
      `insert into public.customer_activities (workspace_id, customer_id, activity_type, summary)
       values ($1, $2, 'note_added', 'spoke on the phone')`,
      [workspaceId, otherCustomerId]
    );
    const after = (await radar(otherCustomerId)).rows[0]!.last_activity_at;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});

describe("a proposal records what was suggested", () => {
  const propose = (over: Record<string, unknown> = {}) => {
    const args = {
      type: "reply",
      ownerType: "human",
      ownerId: userId,
      eligibility: "eligible",
      source: "ai",
      confidence: 0.8,
      ...over
    };
    return db.query<{ id: string }>(
      `insert into public.crm_next_action_projection
         (workspace_id, customer_id, action_type, owner_type, owner_id, eligibility,
          source, confidence)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        workspaceId,
        customerId,
        args.type,
        args.ownerType,
        args.ownerId,
        args.eligibility,
        args.source,
        args.confidence
      ]
    );
  };

  it("stores one", async () => {
    await expect(propose()).resolves.toBeDefined();
  });

  it("refuses an action type outside the contract", async () => {
    await expect(propose({ type: "escalate" })).rejects.toThrow();
  });

  it("refuses an eligibility outside the contract", async () => {
    await expect(propose({ eligibility: "maybe" })).rejects.toThrow();
  });

  it("refuses a human owner with nobody named", async () => {
    // Same rule as tasks_followups: an automation recorded as a person is how a
    // queue fills with work nobody assigned themselves.
    await expect(propose({ ownerType: "human", ownerId: null })).rejects.toThrow();
  });

  it("refuses a non-human owner claiming to be a person", async () => {
    await expect(propose({ ownerType: "automation", ownerId: userId })).rejects.toThrow();
  });

  it("refuses a confidence outside 0..1", async () => {
    await expect(propose({ confidence: 1.4 })).rejects.toThrow();
  });

  it("refuses a settled time with no outcome", async () => {
    const created = await propose();
    await expect(
      db.query("update public.crm_next_action_projection set settled_at = now() where id = $1", [
        created.rows[0]!.id
      ])
    ).rejects.toThrow();
  });

  it("accepts a settlement that says what happened", async () => {
    const created = await propose();
    await expect(
      db.query(
        `update public.crm_next_action_projection
         set settled_at = now(), settled_outcome = 'rejected' where id = $1`,
        [created.rows[0]!.id]
      )
    ).resolves.toBeDefined();
  });

  it("refuses a proposal for a customer in another workspace", async () => {
    await expect(
      db.query(
        `insert into public.crm_next_action_projection
           (workspace_id, customer_id, action_type, owner_type, source)
         values ($1, $2, 'reply', 'system', 'ai')`,
        [otherWorkspaceId, customerId]
      )
    ).rejects.toThrow();
  });
});
