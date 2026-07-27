import { NextResponse } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { buildHealthPayload } from "@/src/lib/health";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildHealthPayload(getServerEnvironment()), {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
