import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MetaChannel } from "./contracts";

export function createSignedMetaOauthState(
  workspaceId: string,
  channel: MetaChannel,
  secret: string,
  issuedAt = Date.now()
) {
  const value = `${workspaceId}.${channel}.${issuedAt}.${randomBytes(12).toString("hex")}`;
  const signature = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${signature}`;
}

export function verifySignedMetaOauthState(
  state: string,
  workspaceId: string,
  channel: MetaChannel,
  secret: string,
  now = Date.now(),
  maxAgeMs = 600_000
) {
  const parts = state.split(".");
  if (parts.length !== 5) return false;
  const issuedAt = Number(parts[2]);
  const age = now - issuedAt;
  if (
    parts[0] !== workspaceId ||
    parts[1] !== channel ||
    !Number.isSafeInteger(issuedAt) ||
    age < 0 ||
    age > maxAgeMs
  )
    return false;
  const supplied = parts[4]!;
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const value = parts.slice(0, 4).join(".");
  const expected = createHmac("sha256", secret).update(value).digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

/**
 * Reads the channel out of a state string without verifying it.
 *
 * The Instagram redirect arrives with no channel of its own — the redirect URI
 * must match the registered one exactly, so it cannot carry our parameters —
 * and the channel has to come from somewhere before verification can be
 * attempted, since verification needs to be told which channel to check.
 *
 * Deliberately not a trust boundary. It parses an untrusted string and returns
 * a guess; the signature check that follows is what establishes the value is
 * genuine. Returning null for anything unrecognised keeps a malformed state
 * from selecting a channel by accident.
 */
export function channelFromMetaOauthState(state: string): MetaChannel | null {
  const parts = state.split(".");
  if (parts.length < 5) return null;
  const candidate = parts[1];
  return candidate === "whatsapp" || candidate === "instagram" ? candidate : null;
}
