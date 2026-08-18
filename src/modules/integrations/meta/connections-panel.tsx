"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import {
  launchEmbeddedSignup,
  preloadEmbeddedSignup,
  sdkReady
} from "@/src/modules/integrations/meta/embedded-signup";
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
type StartResponse = {
  state: string;
  status: string;
  authorizationUrl?: string;
  embeddedSignup?: { appId: string; configId: string };
};

/**
 * Begins a live connection.
 *
 * The two channels diverge completely after this call, which is why the server
 * returns a discriminated response rather than one shape. Instagram is a plain
 * redirect. WhatsApp can only be onboarded through Meta's JS SDK, so the code
 * comes back in the browser and has to be handed to the callback explicitly.
 */
/** Asks the server for a signed state and, for Instagram, the authorize URL. */
async function requestOauthStart(channel: string): Promise<StartResponse> {
  const response = await fetch("/api/connections/meta/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
    body: JSON.stringify({ channel })
  });
  const payload = (await response.json()) as StartResponse & { status?: string };
  if (!response.ok) throw new Error(payload.status ?? "OAUTH_START_FAILED");
  return payload;
}

/** Hands the code and state to the callback for server-side exchange. */
async function exchangeCode(channel: string, state: string, code: string) {
  const exchange = await fetch(
    `/api/connections/meta/callback?format=json&channel=${channel}` +
      `&state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`
  );
  if (!exchange.ok) {
    const failure = (await exchange.json()) as { error?: string; status?: string };
    throw new Error(failure.error ?? failure.status ?? "OAUTH_CALLBACK_FAILED");
  }
}

export function ConnectionsPanel({
  connections,
  canManage,
  liveMode = false,
  graphVersion = "v25.0",
  initialNotice = "",
  appId = "",
  configId = ""
}: {
  connections: Record<string, unknown>[];
  canManage: boolean;
  liveMode?: boolean;
  graphVersion?: string;
  initialNotice?: string;
  /** Public Meta app id. Passed from the server so the click handler needs no
   * round trip before opening the dialog. */
  appId?: string;
  /** Embedded Signup configuration id. Public, same reasoning. */
  configId?: string;
}) {
  const { text } = useI18n();
  const [status, setStatus] = useState(initialNotice);
  const [busy, setBusy] = useState("");

  /** Health, reauthorize and disconnect: a plain call, then re-read the page. */
  async function run(method: string, body: unknown) {
    try {
      await mutate(method, body);
      location.reload();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  // Load Meta's SDK up front so the click handler can open the popup without
  // awaiting anything first. See preloadEmbeddedSignup for why that matters.
  useEffect(() => {
    if (liveMode && appId && configId) {
      void preloadEmbeddedSignup({ appId, configId, graphVersion });
    }
  }, [liveMode, appId, configId, graphVersion]);

  function describe(message: string) {
    if (message === "META_CANCELLED")
      return text("Connection cancelled.", "Bağlantı iptal edildi.", "اتصال لغو شد.");
    if (message === "META_SDK_BLOCKED")
      return text(
        "Meta's script could not load. Disable any content blocker and retry.",
        "Meta betiği yüklenemedi. İçerik engelleyiciyi kapatıp yeniden deneyin.",
        "اسکریپت متا بارگذاری نشد. مسدودکننده محتوا را غیرفعال کنید."
      );
    if (message === "META_SDK_NOT_READY")
      return text(
        "Meta's script is still loading. Wait a moment and try again.",
        "Meta betiği hâlâ yükleniyor. Biraz bekleyip yeniden deneyin.",
        "اسکریپت متا هنوز در حال بارگذاری است. کمی صبر کنید."
      );
    if (message === "META_DIALOG_TIMEOUT")
      return text(
        "Meta's window did not open or was closed. Allow pop-ups for this site and retry.",
        "Meta penceresi açılmadı veya kapatıldı. Bu site için açılır pencerelere izin verin.",
        "پنجره متا باز نشد یا بسته شد. برای این سایت پاپ‌آپ را مجاز کنید."
      );
    return message;
  }

  async function connect(channel: string) {
    setBusy(channel);
    setStatus("");
    try {
      if (!liveMode) {
        await mutate("POST", { channel });
        location.reload();
        return;
      }

      if (channel === "instagram") {
        // A redirect, not a popup, so nothing here depends on the gesture.
        const payload = await requestOauthStart(channel);
        if (!payload.authorizationUrl) throw new Error("OAUTH_START_FAILED");
        window.location.assign(payload.authorizationUrl);
        return;
      }

      if (!appId || !configId) throw new Error("META_LIVE_CONFIGURATION_REQUIRED");

      // Refuse rather than let the SDK raise "init not called with valid
      // version": window.FB exists before init has run, and taking that as
      // readiness is what produced that error.
      if (!sdkReady()) {
        void preloadEmbeddedSignup({ appId, configId, graphVersion });
        throw new Error("META_SDK_NOT_READY");
      }

      // Open the dialog first and fetch the state alongside it. Reversing these
      // two costs the user gesture, and a popup requested after a network round
      // trip is blocked without any error to catch.
      const codePromise = launchEmbeddedSignup({ appId, configId, graphVersion });
      const statePromise = requestOauthStart(channel);
      const [code, payload] = await Promise.all([codePromise, statePromise]);

      await exchangeCode(channel, payload.state, code);
      location.reload();
    } catch (error) {
      setStatus(describe((error as Error).message));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <h2>{text("Meta connections", "Meta bağlantıları", "اتصال‌های متا")}</h2>
        {liveMode ? null : (
          <p className="warning-box">
            <strong>LIVE_MULTI_BUSINESS_BLOCKED_BY_META</strong>
            <br />
            {text(
              "Live self-service requires a verified client-owned Meta portfolio/app, App Review, Advanced Access, Embedded Signup, and Instagram Professional assets. Sandbox is complete and sends nothing.",
              "Canlı kullanım; doğrulanmış müşteri Meta portföyü/uygulaması, App Review, Advanced Access, Embedded Signup ve Instagram Professional varlıkları gerektirir. Sandbox tamamdır ve gönderim yapmaz.",
              "حالت زنده به پورتفولیو و اپ تأییدشده مشتری، App Review، Advanced Access، Embedded Signup و حساب حرفه‌ای اینستاگرام نیاز دارد. Sandbox کامل است و هیچ پیامی نمی‌فرستد."
            )}
          </p>
        )}
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
                  <button disabled={busy === channel} onClick={() => connect(channel)}>
                    {busy === channel
                      ? text("Connecting…", "Bağlanıyor…", "در حال اتصال…")
                      : liveMode
                        ? text("Connect", "Bağla", "اتصال")
                        : text("Connect sandbox", "Sandbox bağla", "اتصال Sandbox")}
                  </button>
                ) : (
                  <>
                    <button onClick={() => run("PATCH", { channel, action: "health" })}>
                      {text("Check health", "Sağlığı kontrol et", "بررسی سلامت")}
                    </button>
                    <button onClick={() => run("PATCH", { channel, action: "reauthorize" })}>
                      {text("Reauthorize", "Yeniden yetkilendir", "مجوزدهی دوباره")}
                    </button>
                    <button
                      className="button-muted"
                      onClick={() => run("PATCH", { channel, action: "disconnect" })}
                    >
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
