import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The score history, enforced where an UPDATE cannot get past it.
 *
 * Both tables are append-only and the reason differs slightly for each. An
 * edited config version makes every snapshot citing it a lie, because the
 * weights it names are no longer the weights it used. An edited snapshot
 * destroys the history rather than correcting it, and the history is the
 * product: a score with no trail is the number nobody trusts.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let customerId: string;
let userId: string;

const CAPS = {
  intent: 25,
  fit: 20,
  need_pain: 15,
  urgency: 10,
  financial_fit: 10,
  commitment: 10,
  engagement: 5,
  data_confidence: 5
};

function snapshot(over: Record<string, unknown> = {}) {
  const args = {
    score: 60,
    components: CAPS,
    penalty: 0,
    confidence: 0.7,
    drivers: [],
    blockers: [],
    version: "crm-score-v1",
    refs: ["msg-1"],
    reasons: [],
    overrideBy: null,
    overrideReason: null,
    ...over
  };
  return db.query<{ snapshot_id: string; previous_score: number | null }>(
    `select * from public.record_score_snapshot(
       $1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)`,
    [
      workspaceId,
      customerId,
      args.score,
      JSON.stringify(args.components),
      args.penalty,
      args.confidence,
      JSON.stringify(args.drivers),
      JSON.stringify(args.blockers),
      args.version,
      args.refs,
      args.reasons,
      args.overrideBy,
      args.overrideReason
    ]
  );
}

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
  const workspace = await db.query<{ id: string }>(
    "insert into public.workspaces (name, status) values ('score-ws', 'active') returning id"
  );
  workspaceId = workspace.rows[0]!.id;
  const customer = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual') returning id`,
    [workspaceId]
  );
  customerId = customer.rows[0]!.id;

  // Inserting into auth.users fires the provisioning trigger, which demands a
  // business_name and creates a workspace of its own. Replica mode is switched
  // off again immediately: the append-only triggers this file exists to check
  // are suppressed by it too, and a test that silently disarmed them would pass
  // for the wrong reason.
  await db.exec("set session_replication_role = replica;");
  const user = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('overrider@example.test') returning id"
  );
  await db.exec("set session_replication_role = origin;");
  userId = user.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("a config version means one thing forever", () => {
  it("stores a config", async () => {
    await expect(
      db.query(
        `insert into public.crm_score_configs (workspace_id, version, components)
         values ($1, 'crm-score-v1', $2::jsonb)`,
        [workspaceId, JSON.stringify(CAPS)]
      )
    ).resolves.toBeDefined();
  });

  it("refuses a second config with the same version", async () => {
    await expect(
      db.query(
        `insert into public.crm_score_configs (workspace_id, version, components)
         values ($1, 'crm-score-v1', $2::jsonb)`,
        [workspaceId, JSON.stringify({ ...CAPS, intent: 30 })]
      )
    ).rejects.toThrow();
  });

  it("refuses an edit to a stored config", async () => {
    // Editing weights under a version already cited by snapshots would make
    // every one of them misreport how it was computed.
    await expect(
      db.query(
        "update public.crm_score_configs set disqualifier_min = -50 where workspace_id = $1",
        [workspaceId]
      )
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    await expect(
      db.query("delete from public.crm_score_configs where workspace_id = $1", [workspaceId])
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a disqualifier floor above zero", async () => {
    await expect(
      db.query(
        `insert into public.crm_score_configs (workspace_id, version, components, disqualifier_min)
         values ($1, 'positive-floor', $2::jsonb, 10)`,
        [workspaceId, JSON.stringify(CAPS)]
      )
    ).rejects.toThrow();
  });
});

describe("snapshots form a history", () => {
  it("records the first snapshot with no previous score", async () => {
    const result = await snapshot({ score: 40 });
    expect(result.rows[0]!.previous_score).toBeNull();
  });

  it("carries the score it followed", async () => {
    const result = await snapshot({ score: 55 });
    // The whole point of the column: the delta is readable from the row.
    expect(result.rows[0]!.previous_score).toBe(40);
  });

  it("refuses an edit to a stored snapshot", async () => {
    await expect(
      db.query("update public.crm_score_snapshots set score = 99 where workspace_id = $1", [
        workspaceId
      ])
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    await expect(
      db.query("delete from public.crm_score_snapshots where workspace_id = $1", [workspaceId])
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a score outside 0..100", async () => {
    await expect(snapshot({ score: 140 })).rejects.toThrow();
  });

  it("refuses a disqualifier penalty that would raise a score", async () => {
    await expect(snapshot({ penalty: 20 })).rejects.toThrow();
  });

  it("refuses a confidence outside 0..1", async () => {
    await expect(snapshot({ confidence: 1.5 })).rejects.toThrow();
  });

  it("refuses a snapshot for a customer in another workspace", async () => {
    const other = await db.query<{ id: string }>(
      "insert into public.workspaces (name, status) values ('other-score', 'active') returning id"
    );
    await expect(
      db.query(
        `select * from public.record_score_snapshot(
           $1, $2, 50, $3::jsonb, 0, 0.5, '[]'::jsonb, '[]'::jsonb, 'crm-score-v1',
           '{}', '{}', null, null)`,
        [other.rows[0]!.id, customerId, JSON.stringify(CAPS)]
      )
    ).rejects.toThrow(/not in workspace/);
  });
});

describe("an override says who and why", () => {
  it("stores one that names both", async () => {
    await expect(
      snapshot({ score: 80, overrideBy: userId, overrideReason: "met them in person" })
    ).resolves.toBeDefined();
  });

  it("refuses one that names an actor and no reason", async () => {
    await expect(snapshot({ overrideBy: userId })).rejects.toThrow();
  });

  it("refuses a reason with nobody behind it", async () => {
    // An override is a person overruling the evidence. Without the person it is
    // just a number with a note attached.
    await expect(snapshot({ overrideReason: "seemed keen" })).rejects.toThrow();
  });
});

describe("evidence says which part of the score it is about", () => {
  it("accepts each component and the disqualifier", async () => {
    for (const component of [
      "intent",
      "fit",
      "need_pain",
      "urgency",
      "financial_fit",
      "commitment",
      "engagement",
      "data_confidence",
      "disqualifier"
    ]) {
      await expect(
        db.query(
          `insert into public.qualification_evidence
             (workspace_id, customer_id, signal, weight, evidence_ref, component)
           values ($1, $2, $3, 10, 'msg-1', $4)`,
          [workspaceId, customerId, `signal-${component}`, component]
        )
      ).resolves.toBeDefined();
    }
  });

  it("refuses a component outside the contract", async () => {
    await expect(
      db.query(
        `insert into public.qualification_evidence
           (workspace_id, customer_id, signal, weight, evidence_ref, component)
         values ($1, $2, 'vibes', 10, 'msg-1', 'vibes')`,
        [workspaceId, customerId]
      )
    ).rejects.toThrow();
  });

  it("still accepts a row with no component, for the rows that predate it", async () => {
    await expect(
      db.query(
        `insert into public.qualification_evidence
           (workspace_id, customer_id, signal, weight, evidence_ref)
         values ($1, $2, 'legacy', 10, 'msg-1')`,
        [workspaceId, customerId]
      )
    ).resolves.toBeDefined();
  });
});
