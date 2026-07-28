import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    await (
      await createBusinessProfileRuntime()
    ).repository.addFaq({
      question: String(body.question ?? ""),
      answer: String(body.answer ?? ""),
      language: String(body.language ?? "en")
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "INVALID_FAQ" }, { status: 400 });
  }
}
