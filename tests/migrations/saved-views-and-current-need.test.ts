import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Saved views, and the need column the radar was missing.
 *
 * A saved view is only "server-owned" if the database refuses a definition the
 * application would not have written, so the constraints are the subject here
 * rather than an implementation detail: a stage nobody defined, a name that
 * collides with another view's in a different case, a definition with nothing
 * in it. Current need is checked against a real engine for the same reason as
 * the rest of the view - a subquery scoped to the wrong column returns a
 * plausible answer from the wrong customer.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let customerId: string;
let otherCustomerId: string;

const need = (customer: string) =>
  db.query<{ current_need: string | null; current_need_confidence: string | null }>(
    "select current_need, current_need_confidence from public.crm_radar_view where customer_id = $1",
    [customer]
  );

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
    `insert into public.workspaces (name, status) values ('views-ws', 'active') returning id`
  );
  workspaceId = workspaces.rows[0]!.id;
  const customers = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual'), ($1, 'Neighbour', 'manual') returning id`,
    [workspaceId]
  );
  customerId = customers.rows[0]!.id;
  otherCustomerId = customers.rows[1]!.id;
});

afterAll(async () => {
  await db?.close();
});

const saveView = (name: string, columns: string, values: string) =>
  db.query(
    `insert into public.crm_saved_views (workspace_id, name, ${columns})
     values ($1, $2, ${values})`,
    [workspaceId, name]
  );

describe("a saved view is a definition the database checks", () => {
  it("stores a definition made of values", async () => {
    await saveView("Stalled deals", "lifecycle_stage, active_within_days", "'opportunity', 30");
    const stored = await db.query<{ lifecycle_stage: string; active_within_days: number }>(
      "select lifecycle_stage, active_within_days from public.crm_saved_views where name = 'Stalled deals'"
    );
    expect(stored.rows[0]).toMatchObject({
      lifecycle_stage: "opportunity",
      active_within_days: 30
    });
  });

  it("refuses a lifecycle stage nobody defined", async () => {
    await expect(saveView("Bogus", "lifecycle_stage", "'almost_qualified'")).rejects.toThrow();
  });

  it("refuses a lead status nobody defined", async () => {
    await expect(saveView("Bogus", "lead_status", "'follow_up'")).rejects.toThrow();
  });

  it("refuses an attention filter that is not one of the two questions", async () => {
    await expect(saveView("Bogus", "attention", "'urgent'")).rejects.toThrow();
  });

  it("refuses a definition with nothing in it", async () => {
    await expect(
      db.query(`insert into public.crm_saved_views (workspace_id, name) values ($1, 'Empty')`, [
        workspaceId
      ])
    ).rejects.toThrow();
  });

  it("refuses a window that is not a number of days", async () => {
    await expect(saveView("Bogus", "active_within_days", "0")).rejects.toThrow();
    await expect(saveView("Bogus", "active_within_days", "4000")).rejects.toThrow();
  });

  it("treats two names that differ only in case as the same name", async () => {
    await saveView("Hot leads", "attention", "'needs_attention'");
    await expect(saveView("  hot LEADS ", "attention", "'needs_attention'")).rejects.toThrow();
  });

  it("keeps a view when the person who defined it is deleted", async () => {
    await db.exec("set session_replication_role = replica;");
    const user = await db.query<{ id: string }>(
      "insert into auth.users (email) values ('leaver@example.test') returning id"
    );
    await db.exec("set session_replication_role = origin;");
    const userId = user.rows[0]!.id;
    await db.query(
      `insert into public.crm_saved_views (workspace_id, name, attention, created_by)
       values ($1, 'Theirs', 'follow_up_due', $2)`,
      [workspaceId, userId]
    );
    await db.query("delete from auth.users where id = $1", [userId]);
    const kept = await db.query<{ created_by: string | null }>(
      "select created_by from public.crm_saved_views where name = 'Theirs'"
    );
    // The view belongs to the workspace: it survives, having lost only its
    // author.
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]!.created_by).toBeNull();
  });

  it("lets go of a workspace's views with the workspace", async () => {
    const other = await db.query<{ id: string }>(
      `insert into public.workspaces (name, status) values ('doomed', 'active') returning id`
    );
    const doomed = other.rows[0]!.id;
    await db.query(
      `insert into public.crm_saved_views (workspace_id, name, attention)
       values ($1, 'Theirs', 'needs_attention')`,
      [doomed]
    );
    await db.query("delete from public.workspaces where id = $1", [doomed]);
    const left = await db.query("select 1 from public.crm_saved_views where workspace_id = $1", [
      doomed
    ]);
    expect(left.rows).toHaveLength(0);
  });
});

describe("current need comes from memory, with its provenance", () => {
  it("says nothing until somebody establishes it", async () => {
    expect((await need(customerId)).rows[0]).toMatchObject({
      current_need: null,
      current_need_confidence: null
    });
  });

  it("reports the remembered need and how firm it is", async () => {
    await db.query(
      `insert into public.contact_facts
         (workspace_id, customer_id, fact_key, fact_value, confidence, source_ref)
       values ($1, $2, 'current_need', 'A quote for 200 units', 'confirmed', 'msg-1')`,
      [workspaceId, customerId]
    );
    expect((await need(customerId)).rows[0]).toMatchObject({
      current_need: "A quote for 200 units",
      current_need_confidence: "confirmed"
    });
  });

  it("does not attribute one customer's need to another", async () => {
    expect((await need(otherCustomerId)).rows[0]!.current_need).toBeNull();
  });

  it("ignores every other remembered fact", async () => {
    await db.query(
      `insert into public.contact_facts
         (workspace_id, customer_id, fact_key, fact_value, confidence, source_ref)
       values ($1, $2, 'budget', 'about 5k', 'inferred', 'msg-2')`,
      [workspaceId, otherCustomerId]
    );
    expect((await need(otherCustomerId)).rows[0]!.current_need).toBeNull();
  });

  it("treats an expired need as absent rather than current", async () => {
    // The memory policy's own rule: stale data must not outrank the absence of
    // data. A need that lapsed last month is what they wanted last month.
    await db.query(
      `insert into public.contact_facts
         (workspace_id, customer_id, fact_key, fact_value, confidence, source_ref, valid_until)
       values ($1, $2, 'current_need', 'Last month''s thing', 'inferred', 'msg-3', now() - interval '1 day')`,
      [workspaceId, otherCustomerId]
    );
    expect((await need(otherCustomerId)).rows[0]!.current_need).toBeNull();
  });
});
