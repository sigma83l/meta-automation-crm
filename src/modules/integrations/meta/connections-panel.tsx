"use client";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
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
  const { text } = useI18n();
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
        <h2>{text("Meta connections", "Meta bağlantıları", "اتصال‌های متا")}</h2>
        <p className="warning-box">
          <strong>
            {text(
              "Live setup requires Meta approval",
              "Canlı kurulum Meta onayı gerektirir",
              "راه‌اندازی زنده به تأیید متا نیاز دارد"
            )}
          </strong>
          <br />
          {text(
            "Live self-service stays blocked until the client-owned Meta portfolio and app have verification, App Review, Advanced Access, Embedded Signup, and eligible Instagram assets. Sandbox sends nothing.",
            "Müşteriye ait Meta portföyü ve uygulaması doğrulama, App Review, Advanced Access, Embedded Signup ve uygun Instagram varlıklarını tamamlayana kadar canlı kullanım kapalıdır. Sandbox gönderim yapmaz.",
            "تا زمانی که پورتفولیو و اپ متعلق به مشتری، تأیید، App Review، Advanced Access، Embedded Signup و دارایی واجد شرایط اینستاگرام را کامل نکنند، حالت زنده بسته می‌ماند. Sandbox هیچ پیامی نمی‌فرستد."
          )}
        </p>
        {!canManage ? (
          <p className="warning-box" role="status">
            {text(
              "Your workspace role can inspect connection health but only an Owner or Admin can connect, reauthorize, or disconnect provider assets.",
              "Rolünüz bağlantı sağlığını görebilir; yalnızca Owner veya Admin bağlantı kurabilir, yenileyebilir ya da kesebilir.",
              "نقش شما می‌تواند سلامت اتصال را ببیند؛ فقط Owner یا Admin می‌تواند اتصال را برقرار، تمدید یا قطع کند."
            )}
          </p>
        ) : null}
        {status && <p role="status">{status}</p>}
        {(["whatsapp", "instagram"] as const).map((channel) => {
          const item = connections.find((c) => c.channel === channel);
          return (
            <article className="connection-card" key={channel}>
              <div>
                <span className="eyebrow">{channel}</span>
                <h3>
                  {item
                    ? String(item.display_name)
                    : text("Not connected", "Bağlı değil", "متصل نیست")}
                </h3>
                <p>
                  {item
                    ? `${String(item.mode)} · ${String(item.status)} · ${String(item.last_health_status)}`
                    : text(
                        "Workspace-owned connection not created.",
                        "Çalışma alanı bağlantısı oluşturulmadı.",
                        "اتصال متعلق به فضای کاری ساخته نشده است."
                      )}
                </p>
              </div>
              <div className="connection-actions">
                {!canManage ? null : !item || item.status === "disconnected" ? (
                  <button onClick={() => run("POST", { channel })}>
                    {text("Connect sandbox", "Sandbox bağla", "اتصال Sandbox")}
                  </button>
                ) : (
                  <>
                    <button onClick={() => run("PATCH", { channel, action: "health" })}>
                      {text("Check health", "Sağlığı kontrol et", "بررسی سلامت")}
                    </button>
                    <button onClick={() => run("PATCH", { channel, action: "reauthorize" })}>
                      {text("Reauthorize", "Yeniden yetkilendir", "مجوزدهی دوباره")}
                    </button>
                    <button className="button-muted" onClick={() => run("DELETE", { channel })}>
                      {text("Disconnect", "Bağlantıyı kes", "قطع اتصال")}
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
