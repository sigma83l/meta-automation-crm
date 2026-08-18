/**
 * Launches Meta's Embedded Signup dialog for WhatsApp.
 *
 * WhatsApp cannot use a plain OAuth redirect the way Instagram does: Meta only
 * exposes WhatsApp Business onboarding through their JS SDK, which opens a
 * dialog and hands back an authorization code through a callback rather than a
 * navigation. That is why this file exists at all, and why the two channels do
 * not share a code path.
 *
 * Browser-only. The SDK is loaded on demand rather than in the document head,
 * so a workspace that never opens Integrations never fetches Meta's script.
 */

type FacebookLoginResponse = Readonly<{
  authResponse?: { code?: string } | null;
  status?: string;
}>;

type FacebookSdk = {
  init(options: Readonly<Record<string, unknown>>): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: Readonly<Record<string, unknown>>
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

/** How long to wait for the dialog before giving up on it. */
const DIALOG_TIMEOUT_MS = 5 * 60 * 1000;

/** True once the SDK is loaded and initialised, so login can be called
 * synchronously from a click handler. */
export function sdkReady(): boolean {
  return typeof window !== "undefined" && Boolean(window.FB);
}

/** Resolves once window.FB exists, loading the script the first time. */
async function loadSdk(appId: string, graphVersion: string): Promise<FacebookSdk> {
  const alreadyLoaded = window.FB;
  if (alreadyLoaded) return alreadyLoaded;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("META_SDK_BLOCKED")), {
        once: true
      });
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(), { once: true });
    // Fires when the CSP blocks it, or an ad blocker does — both are common
    // and neither produces a useful message on its own.
    script.addEventListener("error", () => reject(new Error("META_SDK_BLOCKED")), { once: true });
    document.body.appendChild(script);
  });

  // Read the global fresh: the script we just awaited is what defines it.
  const sdk = window.FB as FacebookSdk | undefined;
  if (!sdk) throw new Error("META_SDK_BLOCKED");
  sdk.init({ appId, cookie: true, xfbml: false, version: graphVersion });
  return sdk;
}

/**
 * Loads the SDK ahead of the click.
 *
 * This is not an optimisation. `FB.login` opens a popup, and a browser only
 * permits that while the user gesture is still live - which it is not after an
 * await on a network round trip. Loading the script beforehand is what lets the
 * click handler call login synchronously; without it the popup is blocked, the
 * callback never fires, and the button sits on "Connecting…" forever with
 * nothing thrown to report.
 */
export async function preloadEmbeddedSignup(config: EmbeddedSignupConfig): Promise<void> {
  try {
    await loadSdk(config.appId, config.graphVersion);
  } catch {
    // A blocked or failed preload is not worth surfacing on page load; the
    // click path reports it, where the user is actually waiting for something.
  }
}

export type EmbeddedSignupConfig = Readonly<{
  appId: string;
  configId: string;
  graphVersion: string;
}>;

/**
 * Opens the dialog and resolves with the authorization code.
 *
 * `response_type: "code"` with `override_default_response_type` is what makes
 * Meta return a code rather than an access token. The distinction matters: a
 * token returned to the browser would be a credential in client-side code,
 * whereas a code is useless without the app secret and can only be exchanged
 * server-side.
 */
export async function launchEmbeddedSignup(config: EmbeddedSignupConfig): Promise<string> {
  // Use the already-loaded SDK when there is one, so no await stands between
  // the click and the popup. Falling back to a load is better than failing,
  // but a popup opened after that await is likely to be blocked.
  const sdk = window.FB ?? (await loadSdk(config.appId, config.graphVersion));

  return new Promise<string>((resolve, reject) => {
    // Nothing below is guaranteed to fire. A blocked popup produces no
    // callback and no error, so without this the promise never settles and the
    // caller has no way to tell the difference between slow and stuck.
    const timer = setTimeout(() => reject(new Error("META_DIALOG_TIMEOUT")), DIALOG_TIMEOUT_MS);
    const settle =
      <T>(fn: (value: T) => void) =>
      (value: T) => {
        clearTimeout(timer);
        fn(value);
      };
    const resolveOnce = settle(resolve);
    const rejectOnce = settle(reject);

    sdk.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (code) {
          resolveOnce(code);
          return;
        }
        // Closing the dialog is by far the most common outcome and is not an
        // error worth alarming anybody about, so it is named separately.
        rejectOnce(new Error(response?.status === "connected" ? "META_NO_CODE" : "META_CANCELLED"));
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} }
      }
    );
  });
}
