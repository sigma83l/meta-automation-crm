/**
 * Reads the session GoTrue leaves in a recovery link's URL fragment.
 *
 * Split out of the component so the parsing is testable without a browser: it
 * is the part with actual decisions in it, and every one of them is a case
 * somebody's mail client can produce.
 */

export type RecoveryTokens = Readonly<{ accessToken: string; refreshToken: string }>;

/**
 * `hash` is `window.location.hash` — with or without its leading `#`.
 *
 * Returns undefined for anything that is not a complete pair. A fragment with
 * only an access token is not a usable session: the reset form needs the
 * refresh token to survive the password change, and half a session fails later
 * and less clearly than no session fails now.
 */
export function parseRecoveryFragment(hash: string): RecoveryTokens | undefined {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0) return undefined;

  const params = new URLSearchParams(raw);

  // An error in the fragment is GoTrue telling us the link is spent or expired.
  // Treating it as "no tokens" is right, and reading past it would be wrong.
  if (params.get("error") || params.get("error_code")) return undefined;

  const accessToken = params.get("access_token")?.trim() ?? "";
  const refreshToken = params.get("refresh_token")?.trim() ?? "";
  if (!accessToken || !refreshToken) return undefined;

  return { accessToken, refreshToken };
}
