"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";

export function LogoutButton() {
  const router = useRouter();
  const { text } = useI18n();
  const [loading, setLoading] = useState(false);

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
      router.replace("/login");
      router.refresh();
      return;
    }
    setLoading(false);
  }

  return (
    <button type="button" onClick={logout} disabled={loading}>
      {loading
        ? text("Signing out…", "Çıkış yapılıyor…", "در حال خروج…")
        : text("Sign out", "Çıkış yap", "خروج")}
    </button>
  );
}
