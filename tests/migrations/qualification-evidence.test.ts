import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Provenance on qualification evidence, enforced by Postgres.
 *
 * The application refuses an unsourced weight at its own boundary, but that
 * boundary is one writer among however many the score engine eventually grows.
 * A constraint is the half of the guarantee that holds for writers nobody has
 * written yet, which is why it is asserted against a real engine rather than
 * against the migration text.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let customerId: string;

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
    "insert into public.workspaces (name, status) values ('evidence-ws', 'active') returning id"
  );
  workspaceId = workspace.rows[0]!.id;
  const customer = await db.query<{ id: string }>(
    `insert into public.customers (workspace_id, display_name, source)
     values ($1, 'Probe', 'manual') returning id`,
    [workspaceId]
  );
  customerId = customer.rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

const insert = (weight: number, evidenceRef: string | null) =>
  db.query(
    `insert into public.qualification_evidence
       (workspace_id, customer_id, signal, weight, evidence_ref)
     values ($1, $2, 'stated_budget', $3, $4)`,
    [workspaceId, customerId, weight, evidenceRef]
  );

describe("weight requires provenance", () => {
  it("accepts a weighted signal that names its source", async () => {
    await expect(insert(20, "msg-1")).resolves.toBeDefined();
  });

  it("refuses a weighted signal with no source", async () => {
    // This is the row that turns a score into an opinion: it carries weight and
    // nothing can say where the weight came from.
    await expect(insert(20, null)).rejects.toThrow();
  });

  it("refuses a negative weight with no source", async () => {
    // Disqualifiers need provenance most of all - an unsourced -100 silently
    // removes a customer from every qualified view.
    await expect(insert(-100, null)).rejects.toThrow();
  });

  it("allows a zero weight with no source", async () => {
    // Recording that a signal was looked for and found absent is legitimate and
    // moves the score by nothing either way.
    await expect(insert(0, null)).resolves.toBeDefined();
  });

  it("still refuses an empty-string source", async () => {
    await expect(insert(20, "")).rejects.toThrow();
  });
});

describe("the per-customer read is indexed", () => {
  it("carries an index leading with workspace and customer", async () => {
    // The score engine reads one customer's evidence, not a workspace-wide
    // feed. Without this the existing (workspace_id, recorded_at desc) index
    // makes that read a filter over every customer in the workspace.
    const result = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'qualification_evidence'`
    );
    const covering = result.rows.filter((row) =>
      /\(workspace_id,\s*customer_id/.test(row.indexdef)
    );
    expect(covering.length).toBeGreaterThan(0);
  });
});
