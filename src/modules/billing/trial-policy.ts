import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/src/lib/env";

export type TrialFingerprintCheck = Readonly<{
  isNew: boolean;
  firstSeenWorkspaceId: string | null;
  firstSeenAt: string | null;
}>;

/**
 * Atomically checks whether a payment-card fingerprint has already
 * consumed a trial, recording it if not. The raw card token is never sent
 * to Postgres — only an HMAC-SHA256 digest, matching the
 * private.auth_rate_limits key_hash pattern. The ledger is append-only and
 * never expires: a card that already used a trial stays "already used"
 * even after the originating workspace is deleted.
 */
export async function checkAndRecordTrialFingerprint(
  admin: SupabaseClient,
  trustedWorkspaceId: string,
  cardFingerprintSource: string
): Promise<TrialFingerprintCheck> {
  const env = getServerEnvironment();
  if (!env.billingFingerprintHashKey) {
    throw new Error("Billing fingerprint hashing is unavailable.");
  }
  const fingerprintHash = createHmac("sha256", env.billingFingerprintHashKey)
    .update(cardFingerprintSource)
    .digest("hex");

  const { data, error } = await admin.rpc("check_and_record_trial_fingerprint", {
    requested_fingerprint_hash: fingerprintHash,
    trusted_workspace_id: trustedWorkspaceId
  });
  if (error) throw new Error("Trial fingerprint check failed.");
  const row = (
    data as readonly {
      is_new: boolean;
      first_seen_workspace_id: string | null;
      first_seen_at: string | null;
    }[]
  )[0];
  if (!row) throw new Error("Trial fingerprint check returned no result.");
  return {
    isNew: row.is_new,
    firstSeenWorkspaceId: row.first_seen_workspace_id,
    firstSeenAt: row.first_seen_at
  };
}
