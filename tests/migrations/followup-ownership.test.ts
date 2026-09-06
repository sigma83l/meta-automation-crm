import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Follow-up ownership, enforced by the column rather than by the caller.
 *
 * The application refuses a mismatched owner at its boundary. The constraint is
 * what holds when the automation runner, an import, or a backfill writes the
 * same table, and an automation recorded as a person is how an operator's queue
 * fills with tasks nobody assigned themselves.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let customerId: string;
let userId: string;

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
  // Inserting into auth.users otherwise fires the provisioning trigger, which
  // demands a business_name in the user metadata and creates a workspace of its
  // own. That is provisioning behaviour tested elsewhere; here it would fight
  // the fixed workspace these constraints are checked against.
  await db.exec("set session_replication_role = replica;");
  const workspace = await db.query<{ id: string }>(
    "insert into public.workspaces (name, status) values ('followup-ws', 'active') returning id"
  );
  workspaceId = workspace.rows[0]!.id;
  const customer = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual') returning id`,
    [workspaceId]
  );
  customerId = customer.rows[0]!.id;
  const user = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('probe@example.test') returning id"
  );
  userId = user.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

const schedule = (ownerType: string, ownerId: string | null) =>
  db.query(
    `insert into public.tasks_followups
       (workspace_id, customer_id, stop_reason, objective, cancel_condition, due_at,
        owner_type, owner_id)
     values ($1, $2, 'price_sent', 'diagnose the obstacle', 'customer declines', now(), $3, $4)`,
    [workspaceId, customerId, ownerType, ownerId]
  );

describe("an owner is either a person or explicitly not one", () => {
  it("accepts a human owner with an id", async () => {
    await expect(schedule("human", userId)).resolves.toBeDefined();
  });

  it("accepts an automation owner with no id", async () => {
    await expect(schedule("automation", null)).resolves.toBeDefined();
  });

  it("refuses a human owner with no id", async () => {
    // A task owned by "a human" in general is owned by nobody in particular.
    await expect(schedule("human", null)).rejects.toThrow();
  });

  it("refuses an automation carrying a person's id", async () => {
    await expect(schedule("automation", userId)).rejects.toThrow();
  });

  it("refuses an owner type outside the vocabulary", async () => {
    await expect(schedule("manager", null)).rejects.toThrow();
  });
});

describe("the columns the follow-up contract requires exist", () => {
  it("carries owner, last result and next eligible time", async () => {
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks_followups'`
    );
    const present = result.rows.map((row) => row.column_name);
    for (const column of ["owner_type", "owner_id", "last_result", "next_eligible_at"]) {
      expect(`${column}:${present.includes(column)}`).toBe(`${column}:true`);
    }
  });

  it("indexes the deferral the due sweep filters on", async () => {
    const result = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'tasks_followups'`
    );
    expect(result.rows.some((row) => /next_eligible_at/.test(row.indexdef))).toBe(true);
  });
});
