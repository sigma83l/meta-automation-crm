/**
 * Launches Meta's Embedded Signup dialog for WhatsApp.
 *
 * WhatsApp cannot use a plain OAuth redirect the way Instagram does: Meta only
 * exposes WhatsApp Business onboarding through their JS SDK, which opens a
 * dialog and hands back an authorization code through a callback rather than a
 * navigation. That is why this file exists, and why the two channels do not
 * share a code path.
 *
 * Three properties of the SDK drive the whole design here, and getting any of
 * them wrong fails silently:
 *
 *   1. `window.FB` is not one object. sdk.js is a two-stage loader: it fires
 *      `fbAsyncInit`, then loads a bundle that replaces the global outright.
 *      An `init` run against the first object does not carry to its
 *      replacement, so neither the global's presence nor a remembered "we
 *      initialised" says anything about the object you are about to call.
 *
 *   2. `FB.login` opens a popup, so it has to be called while the user gesture
 *      is still live. Anything awaited between the click and the call - a
 *      fetch, or loading this script - spends that gesture and the popup is
 *      blocked with no error to catch.
 *
 *   3. The authorization code is only half of what a WhatsApp connection
 *      needs. Which WABA and which phone number the user picked are never in
 *      the code and never in the login callback; they arrive separately, as a
 *      `postMessage` from the dialog. Ignore it and the exchange fails
 *      server-side for want of assets the browser was told and discarded.
 *
 * Hence: load ahead of the click, initialise at the point of use, and listen
 * for the message before opening the dialog that sends it.
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
 * What the dialog hands back.
 *
 * The code alone is not a connection. `verifyWhatsappAccount` needs the WABA
 * and phone number to check that the assets the user picked are the ones it is
 * about to store, and those only exist on the message channel.
 */
export type EmbeddedSignupResult = Readonly<{
  code: string;
  wabaId: string;
  phoneNumberId: string;
}>;

/**
 * Origins the signup message is accepted from.
 *
 * This is a trust boundary, not a formality: `message` events are delivered to
 * this window by whoever holds a handle to it, so without an origin check any
 * page could name the WABA that gets stored against the workspace. Both hosts
 * are Meta's; which one serves the dialog depends on the user's region.
 */
const SIGNUP_ORIGINS: ReadonlySet<string> = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com"
]);

/**
 * How long to keep waiting for the assets once the code has arrived.
 *
 * The dialog posts its message before it closes and the login callback fires
 * on the close, so in practice the assets are already here. Nothing specifies
 * that ordering, though, and losing a real connection to a race would be worth
 * far more than two seconds.
 */
const ASSET_GRACE_MS = 2 * 1000;

type SignupMessage = Readonly<{
  type?: string;
  event?: string;
  data?: Readonly<{ waba_id?: string; phone_number_id?: string }>;
}>;

/**
 * Reads the message payload, which Meta sends as a JSON string.
 *
 * Tolerant by design: this listener sees every message posted to the window,
 * most of them nothing to do with us, and one that fails to parse is not an
 * error - it is somebody else's message.
 */
function readSignupMessage(raw: unknown): SignupMessage | null {
  if (typeof raw === "object" && raw !== null) return raw as SignupMessage;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as SignupMessage) : null;
  } catch {
    return null;
  }
}

/**
 * Opens the dialog and resolves with the code and the chosen assets.
 *
 * `response_type: "code"` with `override_default_response_type` is what makes
 * Meta return a code rather than an access token. The distinction matters: a
 * token handed to the browser would be a credential living in client-side
 * code, whereas a code is useless without the app secret and can only be
 * exchanged server-side.
 *
 * The two halves arrive through different channels - the code through the
 * login callback, the assets through a `postMessage` - so this settles only
 * once it holds both, and names the specific failure when it cannot.
 *
 * `extras.sessionInfoVersion` is what makes the second channel exist at all.
 * It is not a version negotiation to be safely omitted: without it the dialog
 * runs normally, the code comes back, and no message is ever posted.
 */
export async function launchEmbeddedSignup(
  config: EmbeddedSignupConfig
): Promise<EmbeddedSignupResult> {
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

  return new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let assets: { wabaId: string; phoneNumberId: string } | null = null;
    let code: string | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    function onMessage(event: { origin?: string; data?: unknown }) {
      if (!event.origin || !SIGNUP_ORIGINS.has(event.origin)) return;
      const message = readSignupMessage(event.data);
      if (message?.type !== "WA_EMBEDDED_SIGNUP") return;

      if (message.event === "FINISH") {
        const wabaId = message.data?.waba_id;
        const phoneNumberId = message.data?.phone_number_id;
        // A FINISH is supposed to carry both. If it does not, the connection
        // cannot be verified, and saying so beats storing half of one.
        if (!wabaId || !phoneNumberId) {
          settleRejected("META_WHATSAPP_PHONE_REQUIRED");
          return;
        }
        assets = { wabaId, phoneNumberId };
        settleResolved();
        return;
      }
      // The portfolio exists but has no phone number on it yet. The user has
      // to add one at Meta; nothing here can proceed without it.
      if (message.event === "FINISH_ONLY_WABA") {
        settleRejected("META_WHATSAPP_PHONE_REQUIRED");
        return;
      }
      // The user onboarded onto the WhatsApp Business *app* rather than the
      // API. That is a real choice with a real outcome, and the outcome is
      // that there is no phone number id to send messages through. Named so
      // it does not read as a fault of ours.
      if (message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        settleRejected("META_WHATSAPP_APP_NOT_API");
        return;
      }
      // Both of these are also visible through the login callback, but the
      // message says which step failed first and arrives sooner.
      if (message.event === "CANCEL") {
        settleRejected("META_CANCELLED");
        return;
      }
      if (message.event === "ERROR") settleRejected("META_SIGNUP_ERROR");
    }

    const done = () => {
      clearTimeout(dialogTimer);
      clearTimeout(graceTimer);
      window.removeEventListener("message", onMessage);
    };
    const settleRejected = (reason: string) => {
      done();
      reject(new Error(reason));
    };
    const settleResolved = () => {
      if (!code || !assets) return;
      const settled = { code, ...assets };
      done();
      resolve(settled);
    };

    // A blocked popup produces no callback and no error, so without this the
    // promise never settles and the caller cannot tell slow from stuck.
    const dialogTimer = setTimeout(() => settleRejected("META_DIALOG_TIMEOUT"), DIALOG_TIMEOUT_MS);

    // Before the dialog opens, not after: the message it sends cannot be
    // waited for by a listener installed once it has already been delivered.
    window.addEventListener("message", onMessage);

    sdk.login(
      (response) => {
        const returned = response?.authResponse?.code;
        if (!returned) {
          // Closing the dialog is the most common outcome by far and is not an
          // error worth alarming anybody about, so it is named separately.
          settleRejected(response?.status === "connected" ? "META_NO_CODE" : "META_CANCELLED");
          return;
        }
        code = returned;
        if (assets) {
          settleResolved();
          return;
        }
        graceTimer = setTimeout(
          () => settleRejected("META_WHATSAPP_ASSET_MISSING"),
          ASSET_GRACE_MS
        );
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          // Opts into the session-info messages. Without it Meta runs the
          // dialog and posts nothing, so the listener above waits out its
          // grace window and fails every single time - having asked for
          // exactly the data it then refuses to be told.
          sessionInfoVersion: "3"
        }
      }
    );
  });
}
