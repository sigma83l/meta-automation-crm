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
