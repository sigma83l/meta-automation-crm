import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { requireCsrf } from "@/src/modules/auth/security/route";

const preferencesSchema = z.object({
  locale: z.enum(["en", "tr", "fa"]),
  theme: z.enum(["light", "dark", "system"])
});

export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  const parsed = preferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PREFERENCES" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("relay_locale", parsed.data.locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 31_536_000,
    path: "/"
  });
  response.cookies.set("relay_theme", parsed.data.theme, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 31_536_000,
    path: "/"
  });

  try {
    const client = await createSupabaseServerClient();
    const { data } = await client.auth.getUser();
    if (data.user) {
      await client
        .from("profiles")
        .update({ locale: parsed.data.locale, theme: parsed.data.theme })
        .eq("id", data.user.id);
    }
  } catch {
    // Guest preference cookies remain valid when the authenticated stack is absent.
  }

  return response;
}
