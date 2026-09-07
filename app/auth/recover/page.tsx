import { getRequestPreferences } from "@/src/lib/i18n/server";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";
import { RecoveryHandoff } from "@/src/modules/auth/ui/recovery-handoff";

export const dynamic = "force-dynamic";

/**
 * Where a fragment-borne recovery link lands.
 *
 * `/auth/callback` cannot read the tokens — they are in the URL fragment, which
 * no server ever receives — so it redirects here and the browser carries the
 * fragment along. This page exists only to give the client component a place to
 * run; everything it does is in `RecoveryHandoff`.
 */

const allowedDestinations = new Set(["/dashboard", "/onboarding", "/reset-password"]);

export default async function RecoverPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getRequestPreferences();
  const requested = (await searchParams).next;
  const first = Array.isArray(requested) ? requested[0] : requested;
  // Re-checked here rather than trusted from the redirect: this page is
  // reachable directly, and `next` decides where a freshly adopted session is
  // sent.
  const next = first && allowedDestinations.has(first) ? first : "/reset-password";

  return (
    <AuthShell
      eyebrow={t("auth.recoverySession")}
      title={t("auth.newPasswordTitle")}
      description={t("auth.resetDescription")}
    >
      <RecoveryHandoff next={next} />
    </AuthShell>
  );
}
