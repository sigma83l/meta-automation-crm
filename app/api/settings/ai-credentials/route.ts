import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
import {
  deleteWorkspaceCredential,
  storeWorkspaceCredential,
  testWorkspaceCredential
} from "@/src/modules/ai/credential-service";
import { billingBlockedResponse } from "@/src/modules/billing/http";
const providers = new Set(["gemini", "openai", "anthropic"]);
function provider(value: unknown) {
  const result = String(value);
  if (!providers.has(result)) throw new Error("Invalid provider.");
  return result as "gemini" | "openai" | "anthropic";
}
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createBusinessProfileRuntime();
    return NextResponse.json(
      {
        credential: await storeWorkspaceCredential(
          workspace,
          provider(body.provider),
          String(body.key ?? "")
        )
      },
      { status: 201 }
    );
  } catch (error) {
    return billingBlockedResponse(error, "CREDENTIAL_REJECTED", 400);
  }
}
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createBusinessProfileRuntime();
    return NextResponse.json({
      credential: await testWorkspaceCredential(workspace, provider(body.provider))
    });
  } catch (error) {
    return billingBlockedResponse(error, "CONNECTION_TEST_FAILED", 400);
  }
}
export async function DELETE(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createBusinessProfileRuntime();
    await deleteWorkspaceCredential(workspace, provider(body.provider));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingBlockedResponse(error, "CREDENTIAL_DELETE_FAILED", 400);
  }
}
