import { describe, expect, it } from "vitest";

import { MAX_CRM_IMPORT_ROWS, parseCrmCsv } from "@/src/modules/crm/import/csv-import";

describe("CRM CSV import", () => {
  it("accepts normalized headers, quoted commas, and synthetic contacts", () => {
    expect(
      parseCrmCsv(
        'Customer Name,Company,Email,Phone\r\n"Synthetic, Ada",Example Lab,ada@example.test,+10000000000'
      )
    ).toEqual([
      {
        displayName: "Synthetic, Ada",
        companyName: "Example Lab",
        email: "ada@example.test",
        phone: "+10000000000"
      }
    ]);
  });

  it("rejects missing names, malformed quotes, invalid contacts, and row overflow", () => {
    expect(() => parseCrmCsv("email\nada@example.test")).toThrow("IMPORT_HEADER_REQUIRED");
    expect(() => parseCrmCsv('name\n"unterminated')).toThrow("IMPORT_MALFORMED_CSV");
    expect(() => parseCrmCsv("name,email\nAda,not-an-email")).toThrow();
    const overflow = [
      "name",
      ...Array.from({ length: MAX_CRM_IMPORT_ROWS + 1 }, (_, index) => `Synthetic ${index}`)
    ].join("\n");
    expect(() => parseCrmCsv(overflow)).toThrow("IMPORT_ROW_LIMIT");
  });

  it("does not interpret spreadsheet formulas while importing text", () => {
    const [row] = parseCrmCsv("name,company\nSynthetic Ada,=unsafe()");
    expect(row?.companyName).toBe("=unsafe()");
  });
});
