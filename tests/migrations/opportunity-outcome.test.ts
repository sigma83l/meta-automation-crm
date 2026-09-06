import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The win rule, enforced where an UPDATE cannot get past it.
 *
 * The application refuses an AI-declared win at its boundary, and that boundary
 * is one writer. This is the pack's hard fail and the one CRM mistake that
 * invents revenue rather than misfiling something, so it is also asserted where
 * an automation runner, an import or a future model-driven writer would meet
 * it.
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
    "insert into public.workspaces (name, status) values ('opp-ws', 'active') returning id"
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

const settle = (
  stage: string,
  source: string | null,
  evidence: string | null,
  lostReason: string | null = null
) =>
  db.query(
    `insert into public.opportunities
       (workspace_id, customer_id, stage, outcome_source, outcome_evidence_ref,
        outcome_recorded_at, lost_reason)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      workspaceId,
      customerId,
      stage,
      source,
      evidence,
      // Passed rather than derived in SQL: reusing $4 inside a CASE leaves
      // Postgres unable to infer the parameter's type.
      source === null ? null : new Date().toISOString(),
      lostReason
    ]
  );

describe("only a person or a provider may declare a win", () => {
  it("accepts a win from a person, citing what it rests on", async () => {
    await expect(settle("won", "human", "payment-1")).resolves.toBeDefined();
  });

  it("accepts a win from an authoritative provider result", async () => {
    await expect(settle("won", "provider", "charge-1")).resolves.toBeDefined();
  });

  it("refuses a win declared by the model", async () => {
    await expect(settle("won", "ai", "msg-1")).rejects.toThrow();
  });

  it("refuses a win declared by automation or by the system", async () => {
    await expect(settle("won", "automation", "run-1")).rejects.toThrow();
    await expect(settle("won", "system", "job-1")).rejects.toThrow();
  });

  it("refuses a win that cites nothing", async () => {
    await expect(settle("won", "human", null)).rejects.toThrow();
  });

  it("refuses a win that names no source at all", async () => {
    await expect(settle("won", null, "payment-1")).rejects.toThrow();
  });
});

describe("a loss says why", () => {
  it("accepts a loss with a reason, from any source", async () => {
    await expect(settle("lost", "ai", "msg-2", "chose another provider")).resolves.toBeDefined();
  });

  it("refuses a loss with no reason", async () => {
    await expect(settle("lost", "human", "msg-3", null)).rejects.toThrow();
  });
});

describe("an unsettled opportunity carries no claim", () => {
  it("opens with no source and no evidence", async () => {
    await expect(settle("open", null, null)).resolves.toBeDefined();
  });

  it("does not force provenance onto a proposal", async () => {
    // Reopening a premature close must not be blocked by the evidence rule:
    // trapping a mistake is worse than allowing its correction.
    await expect(settle("proposed", null, null)).resolves.toBeDefined();
  });
});
