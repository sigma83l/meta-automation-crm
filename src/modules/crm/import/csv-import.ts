import { z } from "zod";

export const MAX_CRM_IMPORT_BYTES = 1_048_576;
export const MAX_CRM_IMPORT_ROWS = 500;

const rowSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((value) => value === "" || /^[+0-9 ()-]{3,40}$/.test(value), "Invalid phone")
    .default("")
});

export type CrmImportRow = z.infer<typeof rowSchema>;

export function parseCrmCsv(input: string): readonly CrmImportRow[] {
  if (Buffer.byteLength(input, "utf8") > MAX_CRM_IMPORT_BYTES) {
    throw new Error("IMPORT_TOO_LARGE");
  }
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new Error("IMPORT_EMPTY");
  const headers = records[0]!.map(normalizeHeader);
  const displayNameIndex = headers.indexOf("displayName");
  if (displayNameIndex < 0) throw new Error("IMPORT_HEADER_REQUIRED");
  const rows = records.slice(1).filter((record) => record.some((value) => value.trim()));
  if (rows.length > MAX_CRM_IMPORT_ROWS) throw new Error("IMPORT_ROW_LIMIT");

  return Object.freeze(
    rows.map((record) =>
      Object.freeze(
        rowSchema.parse({
          displayName: record[displayNameIndex] ?? "",
          companyName: valueFor("companyName", headers, record),
          email: valueFor("email", headers, record),
          phone: valueFor("phone", headers, record)
        })
      )
    )
  );
}

function valueFor(name: string, headers: readonly string[], record: readonly string[]) {
  const index = headers.indexOf(name);
  return index < 0 ? "" : (record[index] ?? "");
}

function normalizeHeader(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (["displayname", "name", "customername"].includes(normalized)) return "displayName";
  if (["companyname", "company", "business"].includes(normalized)) return "companyName";
  if (["email", "emailaddress"].includes(normalized)) return "email";
  if (["phone", "phonenumber", "mobile"].includes(normalized)) return "phone";
  return `unknown:${normalized}`;
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      record.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("IMPORT_MALFORMED_CSV");
  if (value || record.length) {
    record.push(value);
    records.push(record);
  }
  return records;
}
