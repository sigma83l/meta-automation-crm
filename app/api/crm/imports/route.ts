import { NextResponse, type NextRequest } from "next/server";

import { importCrmCsv } from "@/src/modules/crm/import/import-service";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { workspace } = await createCrmRuntime();
    const result = await importCrmCsv(
      workspace,
      String(body.sourceName ?? ""),
      String(body.csv ?? "")
    );
    return NextResponse.json(result, { status: result.status === "completed" ? 201 : 422 });
  } catch {
    return NextResponse.json({ error: "CRM_IMPORT_REJECTED" }, { status: 400 });
  }
}
