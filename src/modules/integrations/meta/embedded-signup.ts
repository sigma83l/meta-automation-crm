/**
 * Launches Meta's Embedded Signup dialog for WhatsApp.
 *
 * WhatsApp cannot use a plain OAuth redirect the way Instagram does: Meta only
 * exposes WhatsApp Business onboarding through their JS SDK, which opens a
 * dialog and hands back an authorization code through a callback rather than a
 * navigation. That is why this file exists, and why the two channels do not
 * share a code path.
 *
 * Two properties of the SDK drive the whole design here, and getting either
 * wrong fails silently:
 *
 *   1. `window.FB` appears *after* the script's load event, not with it. Code
 *      that reads it on load sees undefined, and code that later sees it
 *      defined cannot conclude `init` has run. The documented hook is
 *      `fbAsyncInit`, which the SDK calls once it is genuinely ready.
 *
 *   2. `FB.login` opens a popup, so it has to be called while the user gesture
 *      is still live. Anything awaited between the click and the call - a
 *      fetch, or loading this script - spends that gesture and the popup is
 *      blocked with no error to catch.
 *
 * Hence: load and initialise ahead of the click, and track readiness with our
 * own handle rather than by probing the global.
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
/** How long to wait for Meta's script. Generous; a blocker fails much sooner. */
const LOAD_TIMEOUT_MS = 15 * 1000;

/**
 * Whether the SDK script has finished loading.
 *
 * Only that. Initialisation is deliberately *not* tracked here, because it
 * cannot be tracked meaningfully: sdk.js is a two-stage loader that fires
 * fbAsyncInit and then loads en_US/bundle/sdk.js, which replaces window.FB
 * outright. An init run against the first object does not carry over to its
 * replacement, and remembering "we initialised" produced exactly one symptom -
 * `FB.login() called before FB.init()` - from an SDK we had, in fact,
 * initialised. So init is run at the point of use instead, where the object
 * being initialised is the object about to be called.
 */
let loading: Promise<FacebookSdk> | null = null;

export function sdkReady(): boolean {
  return typeof window !== "undefined" && Boolean(window.FB);
}

function loadSdk(appId: string, graphVersion: string): Promise<FacebookSdk> {
  const present = window.FB;
  if (present) return Promise.resolve(present);
  if (loading) return loading;

  loading = new Promise<FacebookSdk>((resolve, reject) => {
    const fail = (reason: string) => {
      loading = null;
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail("META_SDK_BLOCKED"), LOAD_TIMEOUT_MS);

    // Registered before the script is injected, because the SDK calls it as
    // soon as it parses and would otherwise run before we were listening.
    window.fbAsyncInit = () => {
      const sdk = window.FB;
      if (!sdk) {
        clearTimeout(timer);
        fail("META_SDK_BLOCKED");
        return;
      }
      // Init here too, so the common case is already initialised and the call
      // at login time is a cheap no-op rather than the only one.
      sdk.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      clearTimeout(timer);
      resolve(sdk);
    };

    // A script tag already present means a previous attempt injected it. If it
    // has since finished, fbAsyncInit has already fired and will not fire again
    // for the handler we just installed, so resolve on what is there rather
    // than waiting for a callback that will never come.
    if (document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const existing = window.FB;
      if (existing) {
        clearTimeout(timer);
        resolve(existing);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    // Fires when a CSP or a content blocker refuses the request. Both are
    // common and neither says anything useful on its own.
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        fail("META_SDK_BLOCKED");
      },
      { once: true }
    );
    document.body.appendChild(script);
  });

  return loading;
}

export type EmbeddedSignupConfig = Readonly<{
  appId: string;
  configId: string;
  graphVersion: string;
}>;

/**
 * Loads and initialises the SDK ahead of the click.
 *
 * Not an optimisation: it is what allows the click handler to call `FB.login`
 * with nothing awaited in front of it. A failure here is left unreported
 * because the user is not waiting on anything yet - the click path raises it,
 * where a message is actionable.
 */
export async function preloadEmbeddedSignup(config: EmbeddedSignupConfig): Promise<void> {
  try {
    await loadSdk(config.appId, config.graphVersion);
  } catch {
    // Deliberately quiet. `loading` has already been reset, so the click path
    // retries rather than inheriting a poisoned promise.
  }
}

/**
 * Opens the dialog and resolves with the authorization code.
 *
 * `response_type: "code"` with `override_default_response_type` is what makes
 * Meta return a code rather than an access token. The distinction matters: a
 * token handed to the browser would be a credential living in client-side
 * code, whereas a code is useless without the app secret and can only be
 * exchanged server-side.
 */
export async function launchEmbeddedSignup(config: EmbeddedSignupConfig): Promise<string> {
  // Use whatever is loaded so no await separates the click from the popup.
  // Falling back to a load is better than refusing, but a popup requested after
  // it is likely to be blocked.
  const sdk = window.FB ?? (await loadSdk(config.appId, config.graphVersion));

  // Initialise the object we are about to call, every time. The two-stage
  // loader may have swapped window.FB since the preload, and init on the
  // superseded object does not carry across. It is idempotent and synchronous,
  // so this costs nothing and does not spend the user gesture.
  sdk.init({
    appId: config.appId,
    cookie: true,
    xfbml: false,
    version: config.graphVersion
  });

  return new Promise<string>((resolve, reject) => {
    // A blocked popup produces no callback and no error, so without this the
    // promise never settles and the caller cannot tell slow from stuck.
    const timer = setTimeout(() => reject(new Error("META_DIALOG_TIMEOUT")), DIALOG_TIMEOUT_MS);

    sdk.login(
      (response) => {
        clearTimeout(timer);
        const code = response?.authResponse?.code;
        if (code) {
          resolve(code);
          return;
        }
        // Closing the dialog is the most common outcome by far and is not an
        // error worth alarming anybody about, so it is named separately.
        reject(new Error(response?.status === "connected" ? "META_NO_CODE" : "META_CANCELLED"));
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
