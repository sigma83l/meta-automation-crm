import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import {
  connectSandbox,
  listMetaConnections,
  updateMetaConnection
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
function channel(value: unknown) {
  if (value !== "whatsapp" && value !== "instagram") throw new Error("Invalid channel.");
  return value;
}
export async function GET() {
  try {
    const { workspace } = await createMetaRuntime();
    return NextResponse.json({ connections: await listMetaConnections(workspace) });
  } catch {
    return NextResponse.json({ error: "CONNECTIONS_UNAVAILABLE" }, { status: 403 });
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
  } catch {
    return NextResponse.json({ error: "CONNECTION_FAILED" }, { status: 400 });
  }
}
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    if (!["health", "reauthorize"].includes(body.action)) throw new Error();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(
      await updateMetaConnection(workspace, channel(body.channel), body.action)
    );
  } catch {
    return NextResponse.json({ error: "CONNECTION_UPDATE_FAILED" }, { status: 400 });
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
  } catch {
    return NextResponse.json({ error: "CONNECTION_DELETE_FAILED" }, { status: 400 });
  }
}
