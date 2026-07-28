"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
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
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
