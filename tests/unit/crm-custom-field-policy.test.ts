import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  AI_WRITE_PERMISSIONS,
  authorizeFieldWrite,
  matchesType,
  type FieldDefinition,
  type FieldWrite
} from "@/src/modules/crm/custom-field-policy";

/**
 * What a workspace-defined field accepts, and from whom.
 *
 * Two rules, and they fail in different directions. Conformance stops a field
 * from holding something it cannot mean - a number field holding "about 5k".
 * `ai_write` stops the model from deciding what an operator's own field says.
 * A custom field is the CRM's least supervised column, so both are asserted at
 * the boundary here and again in the database.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: USER,
  role: "operator"
};

const definition = (over: Partial<FieldDefinition> = {}): FieldDefinition => ({
  fieldKey: "tier",
  fieldType: "text",
  aiWrite: "never",
  ...over
});

const write = (over: Partial<FieldWrite> = {}): FieldWrite => ({
  value: "gold",
  writer: "human",
  sourceRef: "note-1",
  ...over
});

const definitionRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "d1",
  workspace_id: WORKSPACE,
  name: "Tier",
  field_key: "tier",
  field_type: "text",
  ai_write: "never",
  ...over
});

function harness(
  definitions: FakeRow[] = [definitionRow()],
  values: FakeRow[] = [],
  over: Record<string, FakeRow[]> = {}
) {
  const fake = createFakeSupabase({
    tables: {
      custom_field_definitions: definitions,
      customer_custom_field_values: values,
      ...over
    }
  });
  return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
}

describe("a value has to be what the field says it is", () => {
  it("accepts each type in its own shape", () => {
    expect(matchesType("gold", "text")).toBe(true);
    expect(matchesType(5000, "number")).toBe(true);
    expect(matchesType(true, "boolean")).toBe(true);
    expect(matchesType("2026-08-28", "date")).toBe(true);
  });

  it("refuses a number written as a sentence about one", () => {
    // The failure this whole rule exists for: it reads like data and is not.
    expect(matchesType("about 5k", "number")).toBe(false);
  });

  it("refuses NaN and the infinities", () => {
    // All three are typeof number and none survives a round trip as itself.
    expect(matchesType(Number.NaN, "number")).toBe(false);
    expect(matchesType(Number.POSITIVE_INFINITY, "number")).toBe(false);
  });

  it("refuses a blank string as text", () => {
    // Storing "" is indistinguishable from never having answered.
    expect(matchesType("   ", "text")).toBe(false);
  });

  it("refuses a timestamp where a calendar date was asked for", () => {
    // Precision nobody entered is precision nobody should read back.
    expect(matchesType("2026-08-28T14:30:00Z", "date")).toBe(false);
  });

  it("refuses a date that is well formed and not real", () => {
    expect(matchesType("2026-02-31", "date")).toBe(false);
  });

  it("names the field and the expected type when it refuses", () => {
    const verdict = authorizeFieldWrite(definition({ fieldType: "number" }), write());
    expect(verdict).toEqual({ outcome: "refused", reason: "tier holds number" });
  });
});

describe("provenance", () => {
  it("refuses a write that cannot say where it came from", () => {
    expect(authorizeFieldWrite(definition(), write({ sourceRef: "  " }))).toMatchObject({
      outcome: "refused"
    });
  });

  it("marks a person's write as human verified", () => {
    expect(authorizeFieldWrite(definition(), write())).toEqual({
      outcome: "store",
      confidence: "human_verified"
    });
  });

  it("marks an authoritative provider result confirmed, and a plain one weaker", () => {
    expect(
      authorizeFieldWrite(definition(), write({ writer: "provider", authoritative: true }))
    ).toEqual({ outcome: "store", confidence: "confirmed" });
    expect(authorizeFieldWrite(definition(), write({ writer: "provider" }))).toEqual({
      outcome: "store",
      confidence: "high_confidence"
    });
  });

  it("lets an automation write a field the model may not", () => {
    // ai_write governs the model and only the model: an automation copying a
    // webhook payload is transcription, not interpretation.
    expect(
      authorizeFieldWrite(definition({ aiWrite: "never" }), write({ writer: "automation" }))
    ).toEqual({ outcome: "store", confidence: "high_confidence" });
  });
});

describe("ai_write decides what the model may do", () => {
  const model = (aiWrite: FieldDefinition["aiWrite"], authoritative = false) =>
    authorizeFieldWrite(definition({ aiWrite }), write({ writer: "ai", authoritative }));

  it("refuses outright on never", () => {
    expect(model("never")).toMatchObject({ outcome: "refused" });
  });

  it("withholds rather than refuses on suggest", () => {
    // The distinction that would be cosmetic if both simply failed: suggest
    // means the write was legitimate and needs a person.
    expect(model("suggest")).toMatchObject({ outcome: "suggest" });
  });

  it("stores as a guess on inferred", () => {
    expect(model("inferred")).toEqual({ outcome: "store", confidence: "inferred" });
  });

  it("confirms only when the source is authoritative", () => {
    expect(model("confirmed_if_authoritative", true)).toEqual({
      outcome: "store",
      confidence: "confirmed"
    });
    // The permission grants standing to the source, never to the model's own
    // certainty about what it read.
    expect(model("confirmed_if_authoritative")).toEqual({
      outcome: "store",
      confidence: "inferred"
    });
  });

  it("decides every permission in the vocabulary", () => {
    // Guards the enum: a permission added later without a branch here would
    // fall through to whatever the last case happened to be.
    for (const permission of AI_WRITE_PERMISSIONS) {
      expect(["store", "suggest", "refused"]).toContain(model(permission).outcome);
    }
  });
});

describe("the repository boundary", () => {
  it("defines a field closed to the model unless asked otherwise", async () => {
    const { fake, repository } = harness([]);
    const stored = await repository.defineCustomField({
      name: "Tier",
      fieldKey: "tier",
      fieldType: "text"
    });
    expect(stored.aiWrite).toBe("never");
    expect(fake.database.rows("custom_field_definitions")[0]?.ai_write).toBe("never");
  });

  it("refuses a field key the column would refuse", async () => {
    const { repository } = harness([]);
    await expect(
      repository.defineCustomField({ name: "Tier", fieldKey: "Tier Name", fieldType: "text" })
    ).rejects.toThrow();
  });

  it("stores a conforming write with its confidence and source", async () => {
    const { fake, repository } = harness();
    const result = await repository.setCustomFieldValue({
      customerId: CUSTOMER,
      fieldKey: "tier",
      value: "gold",
      writer: "human",
      sourceRef: "note-1"
    });
    expect(result).toMatchObject({ outcome: "stored" });
    const row = fake.database.rows("customer_custom_field_values")[0];
    expect(row).toMatchObject({
      written_by: "human",
      confidence: "human_verified",
      source_ref: "note-1"
    });
  });

  it("refuses a value for a field nobody defined", async () => {
    // A write that defines its own field would let a model invent the schema
    // it then fills in.
    const { fake, repository } = harness();
    const result = await repository.setCustomFieldValue({
      customerId: CUSTOMER,
      fieldKey: "invented",
      value: "gold",
      writer: "ai",
      sourceRef: "msg-9"
    });
    expect(result).toMatchObject({ outcome: "refused" });
    expect(fake.database.rows("customer_custom_field_values")).toHaveLength(0);
  });

  it("writes nothing when the field only permits a suggestion", async () => {
    const { fake, repository } = harness([definitionRow({ ai_write: "suggest" })]);
    const result = await repository.setCustomFieldValue({
      customerId: CUSTOMER,
      fieldKey: "tier",
      value: "gold",
      writer: "ai",
      sourceRef: "msg-9"
    });
    expect(result).toMatchObject({ outcome: "suggested" });
    expect(fake.database.rows("customer_custom_field_values")).toHaveLength(0);
  });

  it("replaces a customer's existing value rather than adding a second", async () => {
    const { fake, repository } = harness();
    for (const value of ["silver", "gold"]) {
      await repository.setCustomFieldValue({
        customerId: CUSTOMER,
        fieldKey: "tier",
        value,
        writer: "human",
        sourceRef: "note-1"
      });
    }
    expect(fake.database.rows("customer_custom_field_values")).toHaveLength(1);
    expect(fake.database.rows("customer_custom_field_values")[0]?.value).toBe("gold");
  });

  it("reads values back under their field key", async () => {
    const { repository } = harness();
    await repository.setCustomFieldValue({
      customerId: CUSTOMER,
      fieldKey: "tier",
      value: "gold",
      writer: "human",
      sourceRef: "note-1"
    });
    expect(await repository.customFieldValuesFor(CUSTOMER)).toEqual([
      expect.objectContaining({ fieldKey: "tier", value: "gold", confidence: "human_verified" })
    ]);
  });

  it("scopes definitions and values to the workspace", async () => {
    const { repository } = harness(
      [definitionRow(), definitionRow({ id: "d2", workspace_id: "other", field_key: "other" })],
      [
        {
          workspace_id: "other",
          customer_id: CUSTOMER,
          definition_id: "d2",
          value: "leaked",
          written_by: "human",
          confidence: "human_verified",
          source_ref: "note-2",
          updated_at: "2026-08-28T00:00:00.000Z"
        }
      ]
    );
    expect(await repository.customFieldDefinitions()).toHaveLength(1);
    expect(await repository.customFieldValuesFor(CUSTOMER)).toHaveLength(0);
  });

  it("refuses to define another field when custom fields are off", async () => {
    const { fake, repository } = harness([], [], {
      workspace_feature_overrides: [
        { workspace_id: WORKSPACE, flag_key: "custom_fields", enabled: false, expires_at: null }
      ]
    });
    await expect(
      repository.defineCustomField({ name: "Tier", fieldKey: "tier", fieldType: "text" })
    ).rejects.toThrow("FEATURE_NOT_ENABLED:custom_fields");
    expect(fake.database.rows("custom_field_definitions")).toHaveLength(0);
  });

  it("keeps showing the fields and values the workspace already has", async () => {
    // Creation is the whole of the gate. A workspace that loses the
    // entitlement stops adding fields; it does not stop seeing the ones it
    // defined or the values it entered against them, because hiding those
    // would withhold the workspace's own data rather than a capability.
    const { repository } = harness(
      [definitionRow()],
      [
        {
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          definition_id: "d1",
          value: "gold",
          written_by: "human",
          confidence: "human_verified",
          source_ref: "note-1",
          updated_at: "2026-08-28T00:00:00.000Z"
        }
      ],
      {
        workspace_feature_overrides: [
          { workspace_id: WORKSPACE, flag_key: "custom_fields", enabled: false, expires_at: null }
        ]
      }
    );
    expect(await repository.customFieldDefinitions()).toHaveLength(1);
    expect(await repository.customFieldValuesFor(CUSTOMER)).toHaveLength(1);
  });
});
