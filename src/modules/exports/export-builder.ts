import * as XLSX from "@e965/xlsx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { safeArchivePath } from "@/src/modules/crm/media/media-policy";
import type { ExportDataset } from "./contracts";

export const workbookSheets = [
  "Customers",
  "Channel Identities",
  "Custom Fields",
  "Consents",
  "Tags",
  "Conversations",
  "Messages",
  "Attachments",
  "Automations",
  "Executions",
  "Timeline",
  "Export Manifest"
] as const;

const sheetHeaders: Record<(typeof workbookSheets)[number], readonly string[]> = {
  Customers: ["id", "display_name", "company_name", "status", "source", "created_at"],
  "Channel Identities": ["id", "customer_id", "channel", "external_id", "username"],
  "Custom Fields": ["id", "customer_id", "definition_id", "value", "updated_at"],
  Consents: ["id", "customer_id", "channel", "status", "opt_out", "captured_at"],
  Tags: ["id", "customer_id", "tag_id", "assigned_at"],
  Conversations: ["id", "customer_id", "channel", "state", "owner", "unread_count"],
  Messages: ["id", "conversation_id", "customer_id", "direction", "status", "body", "sent_at"],
  Attachments: ["customer_id", "original_name", "mime_type", "sha256", "zip_path"],
  Automations: ["id", "customer_id", "automation_key", "source_reference", "state"],
  Executions: ["id", "customer_id", "automation_key", "state", "updated_at"],
  Timeline: ["id", "customer_id", "activity_type", "summary", "occurred_at"],
  "Export Manifest": ["workspace_id", "generated_at", "format_version", "attachment_count"]
};

export function neutralizeSpreadsheetCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || value instanceof Date)
    return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function buildCrmExport(dataset: ExportDataset) {
  const workbook = XLSX.utils.book_new();
  for (const name of workbookSheets) {
    const source =
      name === "Export Manifest"
        ? [
            {
              workspace_id: dataset.workspaceId,
              generated_at: dataset.generatedAt,
              format_version: "1",
              attachment_count: dataset.attachments.length
            }
          ]
        : (dataset.sheets[name] ?? []);
    addSheet(workbook, name, source, sheetHeaders[name]);
  }
  const rawXlsx = new Uint8Array(
    XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
      cellStyles: true,
      Props: { Author: "Relay CRM", CreatedDate: new Date(dataset.generatedAt) }
    })
  );
  const xlsx = styleWorkbookArchive(rawXlsx);
  const archive: Record<string, Uint8Array> = { "crm.xlsx": xlsx };
  const manifestFiles: { path: string; sha256: string; mimeType: string }[] = [];
  for (const file of dataset.attachments) {
    const path = safeArchivePath(file.customerId, file.safeName);
    archive[path] = file.bytes;
    manifestFiles.push({ path, sha256: file.sha256, mimeType: file.mimeType });
  }
  const manifest = {
    formatVersion: 1,
    workspaceId: dataset.workspaceId,
    generatedAt: dataset.generatedAt,
    workbook: "crm.xlsx",
    files: manifestFiles
  };
  archive["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return { xlsx, zip: zipSync(archive, { level: 6 }), manifest };
}

function styleWorkbookArchive(bytes: Uint8Array) {
  const archive = unzipSync(bytes);
  const stylesPath = "xl/styles.xml";
  const styles = strFromU8(archive[stylesPath]!);
  archive[stylesPath] = strToU8(
    styles
      .replace('<fonts count="1">', '<fonts count="2">')
      .replace(
        "</fonts>",
        '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
      )
      .replace('<fills count="2">', '<fills count="3">')
      .replace(
        "</fills>",
        '<fill><patternFill patternType="solid"><fgColor rgb="FF173642"/><bgColor indexed="64"/></patternFill></fill></fills>'
      )
      .replace('<cellXfs count="1">', '<cellXfs count="2">')
      .replace(
        "</cellXfs>",
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf></cellXfs>'
      )
  );
  for (const path of Object.keys(archive).filter((path) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(path)
  )) {
    const xml = strFromU8(archive[path]!);
    archive[path] = strToU8(
      xml
        .replace(
          /<row r="1">(.*?)<\/row>/,
          (_match, cells: string) =>
            `<row r="1" ht="24" customHeight="1">${cells.replaceAll("<c ", '<c s="1" ')}</row>`
        )
        .replace(
          '<sheetView workbookViewId="0"/>',
          '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>'
        )
    );
  }
  return zipSync(archive, { level: 6 });
}

function addSheet(
  workbook: XLSX.WorkBook,
  name: string,
  source: readonly Readonly<Record<string, unknown>>[],
  emptyHeaders: readonly string[]
) {
  const headers = source.length > 0 ? Object.keys(source[0]!) : [...emptyHeaders];
  const rows = [
    headers,
    ...source.map((row) => headers.map((header) => neutralizeSpreadsheetCell(row[header])))
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = headers.map((header) => ({
    wch: Math.min(42, Math.max(14, header.length + 3))
  }));
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
  headers.forEach((_header, index) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "173642" } },
        alignment: { vertical: "center" }
      };
    }
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}
