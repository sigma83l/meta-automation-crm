import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { USAGE_METERS } from "@/src/modules/billing/usage-meters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the usage ledger against a real PostgreSQL engine.
 *
 * The properties that matter here are all enforced by the database and by
 * nothing else: the append-only trigger, the unique idempotency constraint, the
 * one-open-cycle index, and the two different counting rules inside
 * usage_totals_for_cycle. TypeScript sees none of it, so without this the
 * guarantees the billing module is built on would ship unverified.
 */

const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260816120000_usage_ledger.sql", import.meta.url)
);
// Applied on top, so the constraints under test are the ones production has.
const vocabularyPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260911120000_usage_meters_v2_vocabulary.sql",
    import.meta.url
  )
);
const preludePath = fileURLToPath(new URL("./prelude.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let cycleId: string;

async function newWorkspace(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.workspaces (name) values ($1) returning id",
    [name]
  );
  return result.rows[0]!.id;
}

async function newCycle(
  workspace: string,
  options: { startedAt?: string; endsAt?: string; closedAt?: string | null } = {}
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.billing_cycles
       (workspace_id, started_at, ends_at, catalogue_version, plan, closed_at)
     values ($1, $2, $3, 'v1', 'trial', $4) returning id`,
    [
      workspace,
      options.startedAt ?? "2026-08-01T00:00:00Z",
      options.endsAt ?? "2026-09-01T00:00:00Z",
      options.closedAt ?? null
    ]
  );
  return result.rows[0]!.id;
}

async function record(
  meter: string,
  quantity: number,
  idempotencyKey: string,
  contactId: string | null = null,
  cycle: string = cycleId
) {
  await db.query(
    `insert into public.usage_ledger
       (workspace_id, billing_cycle_id, meter, quantity, contact_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, cycle, meter, quantity, contactId, idempotencyKey]
  );
}

async function totals(cycle: string = cycleId): Promise<Record<string, number>> {
  const result = await db.query<{ meter: string; total: string }>(
    "select meter, total from public.usage_totals_for_cycle($1, $2)",
    [workspaceId, cycle]
  );
  return Object.fromEntries(result.rows.map((row) => [row.meter, Number(row.total)]));
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(preludePath, "utf8"));
  await db.exec(readFileSync(migrationPath, "utf8"));
  await db.exec(readFileSync(vocabularyPath, "utf8"));
  workspaceId = await newWorkspace("acme");
  cycleId = await newCycle(workspaceId);
});

afterAll(async () => {
  await db?.close();
});

describe("the ledger is append-only", () => {
  it("accepts an insert", async () => {
    await record("ai_reply", 1, "reply:1");
    const result = await db.query<{ count: string }>(
      "select count(*) as count from public.usage_ledger"
    );
    expect(Number(result.rows[0]!.count)).toBe(1);
  });

  it("refuses an update, even as the owning role", async () => {
    // A ledger that can be quietly edited is not a ledger: a usage dispute
    // becomes unanswerable because the rows no longer say what they said when
    // the invoice was raised.
    await expect(
      db.query("update public.usage_ledger set quantity = 99 where idempotency_key = 'reply:1'")
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    await expect(
      db.query("delete from public.usage_ledger where idempotency_key = 'reply:1'")
    ).rejects.toThrow(/append-only/);
  });

  it("takes a correction as a compensating row", async () => {
    // The way to fix a wrong entry is to say so, not to hide it.
    await record("ai_reply", -1, "reply:1:correction");
    expect((await totals()).ai_reply).toBe(0);
  });
});

describe("duplicate delivery never double-counts", () => {
  it("refuses a repeated idempotency key for the same meter", async () => {
    await record("automation_action", 1, "action:7");
    await expect(record("automation_action", 1, "action:7")).rejects.toThrow(/duplicate key/i);
  });

  it("allows the same key on a different meter", async () => {
    // The keys are namespaced per meter; two meters reacting to one source
    // event are two genuine facts.
    await record("ai_reply", 1, "action:7");
    expect((await totals()).ai_reply).toBe(1);
  });
});

describe("MAC counts distinct contacts", () => {
  it("counts a contact once however many times they interact", async () => {
    const contact = "11111111-1111-4111-8111-111111111111";
    await record("mac", 1, `mac:${cycleId}:${contact}`, contact);
    await expect(record("mac", 1, `mac:${cycleId}:${contact}`, contact)).rejects.toThrow(
      /duplicate key/i
    );
    expect((await totals()).mac).toBe(1);
  });

  it("counts a second contact separately", async () => {
    const contact = "22222222-2222-4222-8222-222222222222";
    await record("mac", 1, `mac:${cycleId}:${contact}`, contact);
    expect((await totals()).mac).toBe(2);
  });

  it("counts the same contact again in a new cycle", async () => {
    // Monthly active means monthly. A contact active in two cycles is two
    // billable facts, not one.
    const laterCycle = await newCycle(await newWorkspace("acme-2"), {
      startedAt: "2026-09-01T00:00:00Z",
      endsAt: "2026-10-01T00:00:00Z"
    });
    const contact = "11111111-1111-4111-8111-111111111111";
    await record("mac", 1, `mac:${laterCycle}:${contact}`, contact, laterCycle);
    expect((await totals(laterCycle)).mac).toBe(1);
    expect((await totals()).mac).toBe(2);
  });
});

describe("totals are rebuildable from the rows", () => {
  it("sums quantity for non-MAC meters", async () => {
    await record("media_bytes", 4096, "media:1");
    await record("media_bytes", 2048, "media:2");
    expect((await totals()).media_bytes).toBe(6144);
  });

  it("reports nothing for a cycle with no rows", async () => {
    const empty = await newCycle(await newWorkspace("empty"));
    expect(await totals(empty)).toEqual({});
  });

  it("never mixes one workspace's usage into another's", async () => {
    const otherWorkspace = await newWorkspace("rival");
    const otherCycle = await newCycle(otherWorkspace);
    await db.query(
      `insert into public.usage_ledger
         (workspace_id, billing_cycle_id, meter, quantity, idempotency_key)
       values ($1, $2, 'ai_reply', 500, 'rival:1')`,
      [otherWorkspace, otherCycle]
    );
    expect((await totals()).ai_reply).toBe(1);
  });
});

describe("billing cycles", () => {
  it("allows only one open cycle per workspace", async () => {
    // Two would double-count every meter.
    const workspace = await newWorkspace("one-open");
    await newCycle(workspace);
    await expect(newCycle(workspace)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("allows a new cycle once the previous one closes", async () => {
    const workspace = await newWorkspace("rollover");
    const first = await newCycle(workspace);
    await db.query("update public.billing_cycles set closed_at = now() where id = $1", [first]);
    await expect(newCycle(workspace)).resolves.toBeDefined();
  });

  it("refuses a cycle that ends before it starts", async () => {
    const workspace = await newWorkspace("backwards");
    await expect(
      newCycle(workspace, { startedAt: "2026-09-01T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" })
    ).rejects.toThrow(/billing_cycles_period_ordered/);
  });

  it("records the catalogue version the cycle was priced under", async () => {
    const result = await db.query<{ catalogue_version: string }>(
      "select catalogue_version from public.billing_cycles where id = $1",
      [cycleId]
    );
    expect(result.rows[0]!.catalogue_version).toBe("v1");
  });
});

describe("tenant isolation and privileges", () => {
  it("forces row level security on both tables", async () => {
    const result = await db.query<{ relname: string; ok: boolean }>(
      `select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('usage_ledger', 'billing_cycles')`
    );
    expect(result.rows.length).toBe(2);
    for (const row of result.rows) expect(`${row.relname}:${row.ok}`).toBe(`${row.relname}:true`);
  });

  it("lets members read usage but never write it", async () => {
    // Caps are server-side, which is worth nothing if a member can insert
    // their own ledger rows.
    const result = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'usage_ledger' and grantee = 'authenticated'`
    );
    const granted = result.rows.map((row) => row.privilege_type);
    expect(granted).toEqual(["SELECT"]);
  });

  it("gives service_role no way to update or delete the ledger", async () => {
    const result = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'usage_ledger' and grantee = 'service_role'`
    );
    const granted = result.rows.map((row) => row.privilege_type).sort();
    expect(granted).toEqual(["INSERT", "SELECT"]);
  });

  it("keeps the totals function off the anon and authenticated roles", async () => {
    const result = await db.query<{ count: string }>(
      `select count(*) as count from information_schema.role_routine_grants
        where routine_name = 'usage_totals_for_cycle' and grantee in ('anon', 'authenticated')`
    );
    expect(Number(result.rows[0]!.count)).toBe(0);
  });
});

describe("the 2026-09-v2 meter vocabulary", () => {
  /** A workspace of its own, because only one cycle per workspace may be open. */
  async function ownCycle(label: string): Promise<{ workspace: string; cycle: string }> {
    const workspace = await newWorkspace(label);
    const result = await db.query<{ id: string }>(
      `insert into public.billing_cycles
         (workspace_id, started_at, ends_at, catalogue_version, plan)
       values ($1, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', '2026-09-v2', 'growth')
       returning id`,
      [workspace]
    );
    return { workspace, cycle: result.rows[0]!.id };
  }

  async function write(workspace: string, cycle: string, meter: string, quantity: number) {
    await db.query(
      `insert into public.usage_ledger
         (workspace_id, billing_cycle_id, meter, quantity, idempotency_key)
       values ($1, $2, $3, $4, $5)`,
      [workspace, cycle, meter, quantity, `${meter}:1`]
    );
  }

  it("accepts every meter the current catalogue prices", async () => {
    const { workspace, cycle } = await ownCycle("meters-current");
    await write(workspace, cycle, "ai_work_units", 5);
    await write(workspace, cycle, "automation_actions", 2);
    await write(workspace, cycle, "connector_units", 7);
    const result = await db.query<{ meter: string; total: string }>(
      "select meter, total from public.usage_totals_for_cycle($1, $2)",
      [workspace, cycle]
    );
    const byMeter = Object.fromEntries(result.rows.map((r) => [r.meter, Number(r.total)]));
    expect(byMeter).toMatchObject({ ai_work_units: 5, automation_actions: 2, connector_units: 7 });
  });

  it("still reads a row written under the retired meters", async () => {
    // Additive on purpose: an append-only ledger whose old rows stop being
    // insertable is a ledger whose old invoices stop being explainable.
    const { workspace, cycle } = await ownCycle("meters-legacy");
    await write(workspace, cycle, "ai_reply", 3);
    const result = await db.query<{ total: string }>(
      "select total from public.usage_totals_for_cycle($1, $2) where meter = 'ai_reply'",
      [workspace, cycle]
    );
    expect(Number(result.rows[0]!.total)).toBe(3);
  });

  it("refuses a meter nobody defined", async () => {
    const { workspace, cycle } = await ownCycle("meters-invented");
    await expect(write(workspace, cycle, "invented_meter", 1)).rejects.toThrow(
      /usage_ledger_meter_check/
    );
  });

  it("accepts a cycle on any current tier, and still on a retired one", async () => {
    for (const plan of ["free", "solo", "growth", "business", "agency", "trial", "starter"]) {
      const result = await db.query<{ id: string }>(
        `insert into public.billing_cycles
           (workspace_id, started_at, ends_at, catalogue_version, plan)
         values ($1, '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', '2026-09-v2', $2)
         returning id`,
        [await newWorkspace(`plan-${plan}`), plan]
      );
      expect(`${plan}:${result.rows.length}`).toBe(`${plan}:1`);
    }
  });

  it("admits exactly the meters the application declares", async () => {
    // The union and the check constraint are written in two languages and can
    // drift silently: the symptom would be a turn that meters correctly in
    // tests and throws on insert in production.
    for (const meter of USAGE_METERS) {
      const { workspace, cycle } = await ownCycle(`drift-${meter}`);
      await expect(write(workspace, cycle, meter, 1)).resolves.not.toThrow();
    }
  });

  it("refuses a tier nobody sells", async () => {
    await expect(
      db.query(
        `insert into public.billing_cycles
           (workspace_id, started_at, ends_at, catalogue_version, plan)
         values ($1, '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', '2026-09-v2', 'enterprise')`,
        [await newWorkspace("plan-enterprise")]
      )
    ).rejects.toThrow(/billing_cycles_plan_check/);
  });
});
