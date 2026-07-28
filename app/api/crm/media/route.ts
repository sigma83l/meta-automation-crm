import { NextResponse, type NextRequest } from "next/server";

import { requireCsrf } from "@/src/modules/auth/security/route";
import { MediaRepository } from "@/src/modules/crm/media/media-repository";
import { createCrmRuntime } from "@/src/modules/crm/runtime";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const customerId = String(form.get("customerId") ?? "");
    if (!(file instanceof File)) throw new Error("FILE_REQUIRED");
    const { client, workspace } = await createCrmRuntime();
    const stored = await new MediaRepository(client, workspace).upload(
      customerId,
      new Uint8Array(await file.arrayBuffer()),
      file.name
    );
    return NextResponse.json({ file: stored }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MEDIA_REJECTED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("id") ?? "";
    const { client, workspace } = await createCrmRuntime();
    const url = await new MediaRepository(client, workspace).signedDownload(fileId);
    return NextResponse.json({ url, expiresIn: 60 });
  } catch {
    return NextResponse.json({ error: "FILE_NOT_AVAILABLE" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const fileId = request.nextUrl.searchParams.get("id") ?? "";
    const { client, workspace } = await createCrmRuntime();
    await new MediaRepository(client, workspace).remove(fileId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "FILE_NOT_AVAILABLE" }, { status: 404 });
  }
}
