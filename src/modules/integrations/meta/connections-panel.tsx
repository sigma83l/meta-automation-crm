"use client";
import { useState } from "react";
async function csrf() {
  return ((await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string }).token;
}
async function mutate(method: string, body: unknown) {
  const response = await fetch("/api/connections/meta", {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("Connection action failed.");
  return response.json();
}
export function ConnectionsPanel({
  connections,
  canManage
}: {
  connections: Record<string, unknown>[];
  canManage: boolean;
}) {
  const [status, setStatus] = useState("");
  async function run(method: string, body: unknown) {
    try {
      await mutate(method, body);
      location.reload();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  return (
    <div className="settings-stack">
      <section className="settings-card">
        <h2>Meta connections</h2>
        <p className="warning-box">
          <strong>LIVE_MULTI_BUSINESS_BLOCKED_BY_META</strong>
          <br />
          Live self-service requires a verified client-owned Meta portfolio/app, App Review,
          Advanced Access, Embedded Signup, and Instagram Professional assets. Sandbox is complete
          and sends nothing.
        </p>
        {!canManage ? (
          <p className="warning-box" role="status">
            Your workspace role can inspect connection health but only an Owner or Admin can
            connect, reauthorize, or disconnect provider assets.
          </p>
        ) : null}
        {status && <p role="status">{status}</p>}
        {(["whatsapp", "instagram"] as const).map((channel) => {
          const item = connections.find((c) => c.channel === channel);
          return (
            <article className="connection-card" key={channel}>
              <div>
                <span className="eyebrow">{channel}</span>
                <h3>{item ? String(item.display_name) : "Not connected"}</h3>
                <p>
                  {item
                    ? `${String(item.mode)} · ${String(item.status)} · ${String(item.last_health_status)}`
                    : "Workspace-owned connection not created."}
                </p>
              </div>
              <div className="connection-actions">
                {!canManage ? null : !item || item.status === "disconnected" ? (
                  <button onClick={() => run("POST", { channel })}>Connect sandbox</button>
                ) : (
                  <>
                    <button onClick={() => run("PATCH", { channel, action: "health" })}>
                      Check health
                    </button>
                    <button onClick={() => run("PATCH", { channel, action: "reauthorize" })}>
                      Reauthorize
                    </button>
                    <button className="button-muted" onClick={() => run("DELETE", { channel })}>
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
