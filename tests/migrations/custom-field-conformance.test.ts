import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Conformance and authority, enforced where an INSERT cannot get past them.
 *
 * The application checks both at its boundary, and that boundary is one writer.
 * A custom field is written by the ones this repository does not contain too -
 * an import, a backfill, the automation runner - and a field that holds
 * whatever the last writer felt like is worse than no field, because everything
 * downstream reads it as data.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let customerId: string;

async function define(fieldKey: string, fieldType: string, aiWrite = "never") {
  const result = await db.query<{ id: string }>(
    `insert into public.custom_field_definitions
       (workspace_id, name, field_key, field_type, ai_write)
     values ($1, $2, $3, $4, $5) returning id`,
    [workspaceId, fieldKey, fieldKey, fieldType, aiWrite]
  );
  return result.rows[0]!.id;
}

const setValue = (definitionId: string, value: unknown, writtenBy: string | null = null) =>
  db.query(
    `insert into public.customer_custom_field_values
       (workspace_id, customer_id, definition_id, value, written_by)
     values ($1, $2, $3, $4::jsonb, $5)`,
    [workspaceId, customerId, definitionId, JSON.stringify(value), writtenBy]
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
    "insert into public.workspaces (name, status) values ('field-ws', 'active') returning id"
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

describe("a value must match its definition's type", () => {
  it("accepts each type in its own shape", async () => {
    await expect(setValue(await define("tier", "text"), "gold")).resolves.toBeDefined();
    await expect(setValue(await define("budget", "number"), 5000)).resolves.toBeDefined();
    await expect(setValue(await define("vip", "boolean"), true)).resolves.toBeDefined();
    await expect(setValue(await define("renews", "date"), "2026-08-28")).resolves.toBeDefined();
  });

  it("refuses a number written as a sentence about one", async () => {
    const id = await define("estimate", "number");
    await expect(setValue(id, "about 5k")).rejects.toThrow(/expects number/);
  });

  it("refuses a boolean written as the word", async () => {
    const id = await define("flagged", "boolean");
    await expect(setValue(id, "true")).rejects.toThrow(/expects boolean/);
  });

  it("refuses a timestamp where a calendar date was asked for", async () => {
    const id = await define("starts", "date");
    await expect(setValue(id, "2026-08-28T14:30:00Z")).rejects.toThrow(/ISO date/);
  });

  it("refuses a date that is well formed and does not exist", async () => {
    // The shape being right is not the date being real.
    const id = await define("expires", "date");
    await expect(setValue(id, "2026-02-31")).rejects.toThrow(/does not exist/);
  });

  it("checks an update as well as an insert", async () => {
    // A row that conformed on the way in can be edited into one that does not.
    const id = await define("seats", "number");
    await setValue(id, 4);
    await expect(
      db.query(
        `update public.customer_custom_field_values set value = '"many"'::jsonb
         where definition_id = $1`,
        [id]
      )
    ).rejects.toThrow(/expects number/);
  });
});

describe("ai_write decides what the model may write", () => {
  it("defaults a field to closed", async () => {
    const result = await db.query<{ ai_write: string }>(
      `insert into public.custom_field_definitions (workspace_id, name, field_key, field_type)
       values ($1, 'Legacy', 'legacy', 'text') returning ai_write`,
      [workspaceId]
    );
    // Every field that existed before this migration was created without anyone
    // considering the question, and no is the safe reading of that silence.
    expect(result.rows[0]!.ai_write).toBe("never");
  });

  it("refuses a model write to a never field", async () => {
    const id = await define("contract_value", "text", "never");
    await expect(setValue(id, "50000", "ai")).rejects.toThrow(/does not accept a model write/);
  });

  it("refuses a model write to a suggest field", async () => {
    // A suggestion is not a stored value, and this table is where stored
    // values live.
    const id = await define("industry", "text", "suggest");
    await expect(setValue(id, "retail", "ai")).rejects.toThrow(/does not accept a model write/);
  });

  it("permits a model write to an inferred field", async () => {
    const id = await define("segment", "text", "inferred");
    await expect(setValue(id, "smb", "ai")).resolves.toBeDefined();
  });

  it("lets a person write a field the model may not", async () => {
    const id = await define("owner_note", "text", "never");
    await expect(setValue(id, "spoke Tuesday", "human")).resolves.toBeDefined();
  });

  it("lets an automation write one too", async () => {
    // ai_write governs the model, and only the model.
    const id = await define("form_source", "text", "never");
    await expect(setValue(id, "landing-page", "automation")).resolves.toBeDefined();
  });

  it("refuses a writer outside the vocabulary", async () => {
    const id = await define("channel", "text", "inferred");
    await expect(setValue(id, "whatsapp", "intern")).rejects.toThrow();
  });

  it("refuses an ai_write value outside the vocabulary", async () => {
    await expect(define("loose", "text", "always")).rejects.toThrow();
  });
});

describe("workspace scoping", () => {
  it("refuses a value pointing at another workspace's definition", async () => {
    const other = await db.query<{ id: string }>(
      "insert into public.workspaces (name, status) values ('other-ws', 'active') returning id"
    );
    const otherWorkspace = other.rows[0]!.id;
    const foreign = await db.query<{ id: string }>(
      `insert into public.custom_field_definitions (workspace_id, name, field_key, field_type)
       values ($1, 'Tier', 'tier', 'text') returning id`,
      [otherWorkspace]
    );
    await expect(setValue(foreign.rows[0]!.id, "gold", "human")).rejects.toThrow();
  });
});
