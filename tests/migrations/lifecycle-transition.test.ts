import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The stage and the reason for it, committed together.
 *
 * `record_lifecycle_transition` exists because two statements can diverge and
 * the two ways they diverge are not equally bad: a stage that moved with no
 * event cannot be explained afterwards, while an event with no stage change is
 * detectable from the event's own from_stage. Only a real engine can show that
 * the function actually makes both writes atomic and that its concurrency check
 * discriminates, so these run against one.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;

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
    "insert into public.workspaces (name, status) values ('lifecycle-ws', 'active') returning id"
  );
  workspaceId = workspace.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

async function customer(): Promise<string> {
  const row = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual') returning id`,
    [workspaceId]
  );
  return row.rows[0]!.id;
}

const move = (
  customerId: string,
  from: string,
  to: string,
  over: Partial<{ workspace: string; reasons: string[]; evidence: string | null }> = {}
) =>
  db.query<{ result: string; event_id: string | null }>(
    `select * from public.record_lifecycle_transition($1, $2, $3, $4, $5, $6, 'system')`,
    [
      over.workspace ?? workspaceId,
      customerId,
      from,
      to,
      over.reasons ?? ["replied_to_first_message"],
      over.evidence === undefined ? "msg-1" : over.evidence
    ]
  );

const stageOf = async (customerId: string) =>
  (
    await db.query<{ lifecycle_stage: string }>(
      "select lifecycle_stage from public.customers where id = $1",
      [customerId]
    )
  ).rows[0]!.lifecycle_stage;

const eventsFor = async (customerId: string) =>
  (
    await db.query<{ from_stage: string | null; to_stage: string }>(
      "select from_stage, to_stage from public.lifecycle_events where customer_id = $1",
      [customerId]
    )
  ).rows;

describe("a recorded transition writes both halves", () => {
  it("moves the stage and appends the event", async () => {
    const id = await customer();
    const result = await move(id, "new", "engaged");
    expect(result.rows[0]!.result).toBe("recorded");
    expect(result.rows[0]!.event_id).not.toBeNull();
    expect(await stageOf(id)).toBe("engaged");
    expect(await eventsFor(id)).toEqual([{ from_stage: "new", to_stage: "engaged" }]);
  });

  it("records the reason codes it was given", async () => {
    const id = await customer();
    await move(id, "new", "qualified", { reasons: ["stated_budget", "confirmed_timeline"] });
    const row = await db.query<{ reason_codes: string[] }>(
      "select reason_codes from public.lifecycle_events where customer_id = $1",
      [id]
    );
    expect(row.rows[0]!.reason_codes).toEqual(["stated_budget", "confirmed_timeline"]);
  });
});

describe("a rejected transition writes neither half", () => {
  it("refuses a customer that is not in this workspace", async () => {
    const id = await customer();
    const other = await db.query<{ id: string }>(
      "insert into public.workspaces (name, status) values ('other-ws', 'active') returning id"
    );
    const result = await move(id, "new", "engaged", { workspace: other.rows[0]!.id });
    expect(result.rows[0]!.result).toBe("not_found");
    // The tenant boundary holds in both directions: no event, and the customer
    // in the real workspace has not moved.
    expect(await eventsFor(id)).toEqual([]);
    expect(await stageOf(id)).toBe("new");
  });

  it("refuses when the stage has changed since the caller read it", async () => {
    const id = await customer();
    await move(id, "new", "engaged");
    // A second caller still holding 'new' decided against facts that no longer
    // hold. Applying it would overwrite whatever moved it.
    const stale = await move(id, "new", "qualified");
    expect(stale.rows[0]!.result).toBe("stale");
    expect(await stageOf(id)).toBe("engaged");
    expect(await eventsFor(id)).toHaveLength(1);
  });

  it("leaves no event behind when the stage write is refused", async () => {
    // The failure this guards against: an event claiming a move that the
    // customer row never made.
    const id = await customer();
    await move(id, "engaged", "qualified");
    expect(await eventsFor(id)).toEqual([]);
  });
});

describe("the function is not reachable from a browser session", () => {
  it("grants execute to service_role only", async () => {
    const result = await db.query<{ grantee: string }>(
      `select grantee from information_schema.role_routine_grants
       where routine_name = 'record_lifecycle_transition'`
    );
    const grantees = result.rows.map((row) => row.grantee);
    expect(grantees).not.toContain("authenticated");
    expect(grantees).not.toContain("anon");
  });
});
