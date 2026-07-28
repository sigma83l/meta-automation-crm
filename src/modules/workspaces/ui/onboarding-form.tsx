"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function complete() {
    setLoading(true);
    const { token } = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "x-csrf-token": token }
    });
    if (response.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setLoading(false);
  }

  return (
    <button onClick={complete} disabled={loading}>
      {loading ? "Preparing…" : "Enter sandbox workspace"}
    </button>
  );
}
