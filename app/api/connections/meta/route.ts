import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import {
  connectSandbox,
  listMetaConnections,
  updateMetaConnection
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { billingBlockedResponse } from "@/src/modules/billing/http";
function channel(value: unknown) {
  if (value !== "whatsapp" && value !== "instagram") throw new Error("Invalid channel.");
  return value;
}
export async function GET() {
  try {
    const { workspace } = await createMetaRuntime();
    return NextResponse.json({ connections: await listMetaConnections(workspace) });
  } catch (error) {
    return billingBlockedResponse(error, "CONNECTIONS_UNAVAILABLE", 403);
  }
}
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(
      { connection: await connectSandbox(workspace, channel(body.channel)) },
      { status: 201 }
    );
  } catch (error) {
    return billingBlockedResponse(error, "CONNECTION_FAILED", 400);
  }
}
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    // "disconnect" is accepted here as well as on DELETE. Vercel's edge strips
    // request bodies from DELETE, so the browser's disconnect never carried its
    // channel and failed as a malformed request - silently, since the handler
    // reports one generic code. The DELETE route stays for API callers that
    // send the channel some other way.
    if (!["health", "reauthorize", "disconnect"].includes(body.action)) throw new Error();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(
      await updateMetaConnection(workspace, channel(body.channel), body.action)
    );
  } catch (error) {
    return billingBlockedResponse(error, "CONNECTION_UPDATE_FAILED", 400);
  }
}
export async function DELETE(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(
      await updateMetaConnection(workspace, channel(body.channel), "disconnect")
    );
  } catch (error) {
    return billingBlockedResponse(error, "CONNECTION_DELETE_FAILED", 400);
  }
}
