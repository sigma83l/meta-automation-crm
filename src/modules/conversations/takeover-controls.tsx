"use client";
import { useState } from "react";
export function TakeoverControls({
  conversationId,
  owner
}: {
  conversationId: string;
  owner: string;
}) {
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
          ? "Human takeover active."
          : "Automation resumed."
        : "Action failed."
    );
    if (response.ok) location.reload();
  }
  return (
    <div className="takeover-controls">
      <button onClick={() => run(owner === "human" ? "resume" : "takeover")}>
        {owner === "human" ? "Resume automation" : "Take over conversation"}
      </button>
      {status && <span role="status">{status}</span>}
    </div>
  );
}
