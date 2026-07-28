import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = process.argv[2];
if (!workbookPath) throw new Error("Workbook path required.");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 });
if (!sheets.ndjson.includes("Export Manifest") || !sheets.ndjson.includes("Customers")) {
  throw new Error("Required CRM export sheets are missing.");
}
const customers = await workbook.inspect({
  kind: "table",
  sheetId: "Customers",
  range: "A1:C3",
  include: "values,formulas",
  tableMaxRows: 3,
  tableMaxCols: 3,
  maxChars: 2000
});
if (!customers.ndjson.includes("display_name") || !customers.ndjson.includes("Synthetic Studio")) {
  throw new Error("Customers sheet content validation failed.");
}
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "Prompt 2 workbook error scan"
});
if (errors.ndjson.includes('"match"')) throw new Error("Workbook formula error detected.");
const preview = await workbook.render({
  sheetName: "Customers",
  autoCrop: "all",
  scale: 1,
  format: "png"
});
await fs.writeFile("customers-preview.png", new Uint8Array(await preview.arrayBuffer()));
process.stdout.write(
  "Artifact workbook reopen, required-sheet, formula-error, and visual render checks passed.\n"
);
