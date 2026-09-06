import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolvePlatformAdmin } from "@/src/modules/platform-admin/server/runtime";

export const dynamic = "force-dynamic";

/**
 * The console's outer gate.
 *
 * `notFound()` rather than a redirect or a 403 page: a signed-in customer who
 * guesses the URL should see what any visitor to a nonexistent path sees. The
 * page-level runtimes each resolve staff identity again — this layout is the
 * cheap early exit, not the security boundary, because a layout in the App
 * Router is not guaranteed to run before every child render.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const client = await createSupabaseServerClient();
  try {
    await resolvePlatformAdmin(client);
  } catch {
    notFound();
  }
  return <>{children}</>;
}
