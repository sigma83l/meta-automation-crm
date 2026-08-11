"use client";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
export function TakeoverControls({
  conversationId,
  owner
}: {
  conversationId: string;
  owner: string;
}) {
  const { text } = useI18n();
  const [status, setStatus] = useState("");
  async function run(action: "takeover" | "resume") {
    const { token } = (await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string };
    const response = await fetch("/api/inbox/takeover", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ conversationId, action })
    });
    setStatus(
      response.ok
        ? action === "takeover"
          ? text(
              "Human takeover is active.",
              "İnsan devralması etkin.",
              "تحویل به اپراتور فعال است."
            )
          : text("Automation resumed.", "Otomasyon sürdürüldü.", "اتوماسیون از سر گرفته شد.")
        : text("The action could not be completed.", "İşlem tamamlanamadı.", "عملیات انجام نشد.")
    );
    if (response.ok) location.reload();
  }
  return (
    <div className="takeover-controls">
      <button onClick={() => run(owner === "human" ? "resume" : "takeover")}>
        {owner === "human"
          ? text("Resume automation", "Otomasyonu sürdür", "ادامه اتوماسیون")
          : text("Take over conversation", "Görüşmeyi devral", "تحویل گرفتن گفتگو")}
      </button>
      {status && <span role="status">{status}</span>}
    </div>
  );
}
