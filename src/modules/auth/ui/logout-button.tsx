"use client";

import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/src/lib/i18n/client";

/** Never fires: hydration happens once and this store has no later updates. */
const subscribeToNothing = () => () => {};

export function LogoutButton() {
  const { text } = useI18n();
  const [loading, setLoading] = useState(false);
  /**
   * Whether React has taken over this button.
   *
   * Signing out lives entirely in an `onClick`: there is no form to submit and
   * no href to follow, so before hydration the control is painted, focusable,
   * and completely inert. A person who clicks it in that window gets nothing -
   * no navigation, no pending state, no error - and the only recovery is to
   * click again, which is indistinguishable from the product being broken.
   *
   * Disabled until mounted says the true thing instead. It also makes the
   * behaviour testable: a click waits for the control to be enabled, so the
   * race stops being a flake that only appears when the machine is loaded
   * enough to hydrate slowly.
   */
  const ready = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

  async function logout() {
    setLoading(true);
    const { token } = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": token }
    });
    if (response.ok) {
      window.location.replace("/login");
      return;
    }
    setLoading(false);
  }

  return (
    <button type="button" onClick={logout} disabled={loading || !ready}>
      {loading
        ? text("Signing out…", "Çıkış yapılıyor…", "در حال خروج…")
        : text("Sign out", "Çıkış yap", "خروج")}
    </button>
  );
}
