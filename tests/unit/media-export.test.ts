import { mkdir, writeFile } from "node:fs/promises";
import * as XLSX from "@e965/xlsx";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  safeArchivePath,
  sanitizeFilename,
  validateMedia
} from "@/src/modules/crm/media/media-policy";
import {
  buildCrmExport,
  neutralizeSpreadsheetCell,
  workbookSheets
} from "@/src/modules/exports/export-builder";
import type { ExportDataset } from "@/src/modules/exports/contracts";
import { isExportExpired } from "@/src/modules/exports/export-policy";

const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0,
  0, 144, 119, 83, 222
]);
const customerId = "11111111-1111-4111-8111-111111111111";

describe("private media policy", () => {
  it("detects actual MIME and generates a traversal-safe name", async () => {
    const media = await validateMedia(png, "../../avatar.exe", 1024);
    expect(media.mimeType).toBe("image/png");
    expect(media.safeName).toMatch(/^avatar-[a-f0-9-]+\.png$/);
    expect(media.sha256).toHaveLength(64);
  });

  it("rejects spoofed or oversized content", async () => {
    await expect(
      validateMedia(new TextEncoder().encode("not a png"), "photo.png", 1024)
    ).rejects.toThrow("MEDIA_TYPE_REJECTED");
    await expect(validateMedia(png, "photo.png", 10)).rejects.toThrow("MEDIA_SIZE_REJECTED");
  });

  it("prevents ZIP traversal", () => {
    expect(safeArchivePath(customerId, "avatar.png")).toBe(`attachments/${customerId}/avatar.png`);
    expect(() => safeArchivePath(customerId, "../../secret")).toThrow("ZIP_PATH_REJECTED");
    expect(sanitizeFilename("../../a b.png")).toBe("a-b.png");
  });
});

describe("CRM workbook and ZIP", () => {
  it("neutralizes spreadsheet formulas", () => {
    for (const value of ["=2+2", "+cmd", "-1+1", "@SUM(A1)"]) {
      expect(String(neutralizeSpreadsheetCell(value))).toBe(`'${value}`);
    }
    expect(neutralizeSpreadsheetCell("safe")).toBe("safe");
  });

  it("denies expired and malformed export timestamps", () => {
    expect(isExportExpired("2026-01-01T00:00:00.000Z", Date.parse("2026-01-02"))).toBe(true);
    expect(isExportExpired("invalid", Date.now())).toBe(true);
    expect(isExportExpired("2026-01-03T00:00:00.000Z", Date.parse("2026-01-02"))).toBe(false);
  });

  it("reopens all requested sheets and validates ZIP manifest consistency", async () => {
    const dataset: ExportDataset = {
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generatedAt: "2026-07-28T18:00:00.000Z",
      sheets: {
        Customers: [
          { id: customerId, display_name: "=malicious", company_name: "Synthetic Studio" }
        ],
        Attachments: [{ customer_id: customerId, zip_path: `attachments/${customerId}/avatar.png` }]
      },
      attachments: [
        {
          customerId,
          originalName: "avatar.png",
          safeName: "avatar.png",
          objectPath: `workspace/${customerId}/avatar.png`,
          mimeType: "image/png",
          sha256: "0".repeat(64),
          bytes: png
        }
      ]
    };
    const artifact = await buildCrmExport(dataset);
    const workbook = XLSX.read(artifact.xlsx, { type: "array", cellStyles: true });
    expect(workbook.SheetNames).toEqual(workbookSheets);
    expect(workbook.Sheets.Customers?.B2?.v).toBe("'=malicious");
    const archive = unzipSync(artifact.zip);
    expect(Object.keys(archive).sort()).toEqual([
      `attachments/${customerId}/avatar.png`,
      "crm.xlsx",
      "manifest.json"
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(archive["manifest.json"]));
    expect(manifest.files[0].path).toBe(`attachments/${customerId}/avatar.png`);
    expect(JSON.stringify(manifest)).not.toMatch(/token|secret|password|session/i);
    await mkdir("test-results/prompt2", { recursive: true });
    await writeFile("test-results/prompt2/crm.xlsx", artifact.xlsx);
  });
});
