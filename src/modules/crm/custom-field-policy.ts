/**
 * What a custom field will accept, and from whom.
 *
 * A workspace-defined field is the one place in the CRM where the schema is
 * whatever an operator typed last week, and both of the rules that keep it
 * trustworthy are missing from the tables that hold it.
 *
 * The first is conformance. `custom_field_definitions` declares a `field_type`
 * and `customer_custom_field_values` stores jsonb that has never been checked
 * against it, so a field defined as a number happily holds "about 5k". Nothing
 * reading it later can tell a value from a sentence about one, and export,
 * filtering and scoring all read it.
 *
 * The second is authority. `CRM_CUSTOM_FIELD_SCHEMA` gives every field an
 * `ai_write` permission - never, suggest, inferred, confirmed_if_authoritative
 * - because the whole point of an operator-defined field is that the operator
 * decides what it means. A model filling in "Contract value" from a hopeful
 * message is the field-level version of the mistake `authorizeMemoryWrite`
 * exists to stop, and until now there was nowhere to say no.
 *
 * Pure by design; the columns backing this are in the custom field migration.
 */

export const FIELD_TYPES = ["text", "number", "boolean", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const AI_WRITE_PERMISSIONS = [
  "never",
  "suggest",
  "inferred",
  "confirmed_if_authoritative"
] as const;
export type AiWritePermission = (typeof AI_WRITE_PERMISSIONS)[number];

export const FIELD_WRITERS = ["human", "ai", "automation", "provider", "system"] as const;
export type FieldWriter = (typeof FIELD_WRITERS)[number];

/**
 * How much the stored value is worth, weakest first. The same ladder the
 * memory policy compares on, kept local for the same reason `EvidenceInput`
 * keeps it local: these are separate vocabularies that happen to agree today,
 * and a shared import would make a change to one silently change the other.
 */
export const FIELD_CONFIDENCES = [
  "inferred",
  "high_confidence",
  "confirmed",
  "human_verified"
] as const;
export type FieldConfidence = (typeof FIELD_CONFIDENCES)[number];

export type FieldDefinition = Readonly<{
  fieldKey: string;
  fieldType: FieldType;
  aiWrite: AiWritePermission;
}>;

export type FieldWrite = Readonly<{
  value: string | number | boolean;
  writer: FieldWriter;
  /**
   * Whether this rests on an authoritative result rather than a reading of
   * one - a provider record, a form the customer submitted. Only meaningful
   * for `confirmed_if_authoritative`, and never something the model asserts
   * about its own output.
   */
  authoritative?: boolean;
  /** The message, payload or actor the value came from. Never empty. */
  sourceRef: string;
}>;

/**
 * Three outcomes rather than two.
 *
 * `suggest` is the reason. A field marked suggest is one the operator wants the
 * model's help with but not its authority, so refusing the write outright would
 * make `suggest` and `never` behave identically and turn a real distinction
 * into a comment. Returning it as its own outcome says the write was
 * legitimate and needs a person, which is what the caller has to act on. Where
 * suggestions queue is the write engine's problem, not this function's.
 */
export type FieldVerdict =
  | Readonly<{ outcome: "store"; confidence: FieldConfidence }>
  | Readonly<{ outcome: "suggest"; reason: string }>
  | Readonly<{ outcome: "refused"; reason: string }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value is what its definition says the field holds. */
export function matchesType(value: unknown, fieldType: FieldType): boolean {
  switch (fieldType) {
    case "number":
      // Rejects NaN and the infinities: all three are typeof number and none
      // survives a round trip through JSON as itself.
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date": {
      // A calendar date, not a timestamp. Storing "when" at higher precision
      // than the operator asked for invents an accuracy nobody entered.
      if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
      // The shape being right is not the date being real. Date.parse rolls
      // 2026-02-31 forward into March rather than refusing it, so the test is
      // that the date survives a round trip as itself.
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    }
    case "text":
      return typeof value === "string" && value.trim().length > 0;
  }
}

/** What a non-model write is worth, given who made it. */
function confidenceFor(write: FieldWrite): FieldConfidence {
  if (write.writer === "human") return "human_verified";
  if (write.writer === "provider") return write.authoritative ? "confirmed" : "high_confidence";
  // automation and system: reliable transcription of something else, which is
  // better than a guess and short of a person having looked at it.
  return "high_confidence";
}

/** Whether this write may be stored, and as what. */
export function authorizeFieldWrite(definition: FieldDefinition, write: FieldWrite): FieldVerdict {
  if (!write.sourceRef.trim()) {
    // Same rule as memory: a value nobody can trace cannot be corrected later,
    // and a custom field is exactly where an untraceable value goes unnoticed.
    return { outcome: "refused", reason: "missing provenance" };
  }

  if (!matchesType(write.value, definition.fieldType)) {
    return {
      outcome: "refused",
      reason: `${definition.fieldKey} holds ${definition.fieldType}`
    };
  }

  // ai_write governs the model, and only the model. An automation copying a
  // webhook payload into a field is data entry; the permission exists because
  // a model's output is an interpretation, which is a different kind of thing.
  if (write.writer !== "ai") {
    return { outcome: "store", confidence: confidenceFor(write) };
  }

  switch (definition.aiWrite) {
    case "never":
      return { outcome: "refused", reason: `${definition.fieldKey} is not model-writable` };
    case "suggest":
      return { outcome: "suggest", reason: `${definition.fieldKey} needs a person to accept it` };
    case "inferred":
      // Writable, and permanently marked as a guess. The permission grants
      // storage, not standing.
      return { outcome: "store", confidence: "inferred" };
    case "confirmed_if_authoritative":
      return { outcome: "store", confidence: write.authoritative ? "confirmed" : "inferred" };
  }
}
