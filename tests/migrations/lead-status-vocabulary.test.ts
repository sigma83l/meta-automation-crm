import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The statuses a queue is sorted by.
 *
 * The two additions are the point: `needs_reply` and `human_review` are what an
 * operator orders their day by, and the original set could express neither.
 * `lost` is gone in the other direction - it is a lifecycle terminal, and
 * carrying it in both places is how a fact about the relationship gets confused
 * with what a conversation is waiting on.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;

const setStatus = (status: string) =>
  db.query(
    `insert into public.customers (workspace_id, display_name, source, lead_status)
     values ($1, 'Probe', 'manual', $2)`,
    [workspaceId, status]
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
  const workspace = await db.query<{ id: string }>(
    "insert into public.workspaces (name, status) values ('status-ws', 'active') returning id"
  );
  workspaceId = workspace.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("the operational status vocabulary", () => {
  it("accepts every status in the contract", async () => {
    for (const status of [
      "needs_reply",
      "awaiting_customer",
      "follow_up_due",
      "human_review",
      "booked",
      "payment_pending",
      "closed"
    ]) {
      await expect(setStatus(status)).resolves.toBeDefined();
    }
  });

  it("refuses the renamed follow_up", async () => {
    await expect(setStatus("follow_up")).rejects.toThrow();
  });

  it("refuses lost, which belongs to the lifecycle", async () => {
    // A lost deal keeps its lifecycle stage. What it loses is a lead status
    // claiming the conversation is still about losing.
    await expect(setStatus("lost")).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.customers (workspace_id, display_name, source, lifecycle_stage)
         values ($1, 'Lost one', 'manual', 'opportunity')`,
        [workspaceId]
      )
    ).resolves.toBeDefined();
  });

  it("refuses a status nobody defined", async () => {
    await expect(setStatus("thinking_about_it")).rejects.toThrow();
  });

  it("still defaults a new row to a status in the set", async () => {
    const row = await db.query<{ lead_status: string }>(
      `insert into public.customers (workspace_id, display_name, source)
       values ($1, 'Defaulted', 'manual') returning lead_status`,
      [workspaceId]
    );
    expect([
      "needs_reply",
      "awaiting_customer",
      "follow_up_due",
      "human_review",
      "booked",
      "payment_pending",
      "closed"
    ]).toContain(row.rows[0]!.lead_status);
  });
});
