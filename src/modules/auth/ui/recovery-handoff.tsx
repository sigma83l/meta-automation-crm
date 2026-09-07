"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/src/lib/i18n/client";
import { parseRecoveryFragment } from "@/src/modules/auth/recovery-fragment";

/**
 * Turns a fragment-borne recovery session into a cookie session.
 *
 * GoTrue's `/verify` endpoint hands the session back in the URL fragment, which
 * the browser never sends to a server. This is the only place in the app that
 * reads one, and it exists so that the rest of auth can go on being entirely
 * server-side: the tokens are posted once to `/api/auth/session`, which sets the
 * same cookies every other route already reads, and nothing here keeps them.
 *
 * The fragment is cleared before navigating, so a recovery token does not sit in
 * the address bar to be copied, bookmarked or handed to the next page in a
 * `Referer`.
 */
export function RecoveryHandoff({ next }: { next: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const tokens = parseRecoveryFragment(window.location.hash);
    if (!tokens) {
      // Nothing usable: a link that was already spent, hand-edited, or opened
      // after the fragment was stripped by a mail client's link rewriter.
      router.replace("/login?error=session");
      return;
    }
    const { accessToken, refreshToken } = tokens;

    let cancelled = false;
    void (async () => {
      try {
        const token = (
          (await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string }
        ).token;
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ accessToken, refreshToken })
        });
        if (cancelled) return;
        // Drop the tokens from the address bar either way.
        window.history.replaceState(null, "", window.location.pathname);
        if (!response.ok) {
          setFailed(true);
          router.replace("/login?error=session");
          return;
        }
        router.replace(next);
      } catch {
        if (cancelled) return;
        setFailed(true);
        router.replace("/login?error=session");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  return (
    <p role="status" aria-live="polite">
      {failed ? t("auth.recoveryFailed") : t("auth.recoveryInProgress")}
    </p>
  );
}
