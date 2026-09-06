"use client";

import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { useHydrated } from "@/src/lib/react/use-hydrated";

export function LogoutButton() {
  const { text } = useI18n();
  const [loading, setLoading] = useState(false);
  /** Signing out lives entirely in an `onClick`. See useHydrated. */
  const ready = useHydrated();

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
