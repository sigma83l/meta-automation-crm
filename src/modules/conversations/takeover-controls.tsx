"use client";
import { useState } from "react";
import { useHydrated } from "@/src/lib/react/use-hydrated";
export function TakeoverControls({
  conversationId,
  owner
}: {
  conversationId: string;
  owner: string;
}) {
  const [status, setStatus] = useState("");
  /**
   * Taking over reloads the page, and the control someone reaches for next is
   * the same control - now reading "Resume automation" in a document that has
   * not hydrated. See useHydrated: that click would do nothing and say nothing.
   */
  const ready = useHydrated();
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
          ? "Human takeover active."
          : "Automation resumed."
        : "Action failed."
    );
    if (response.ok) location.reload();
  }
  return (
    <div className="takeover-controls">
      <button disabled={!ready} onClick={() => run(owner === "human" ? "resume" : "takeover")}>
        {owner === "human" ? "Resume automation" : "Take over conversation"}
      </button>
      {status && <span role="status">{status}</span>}
    </div>
  );
}
