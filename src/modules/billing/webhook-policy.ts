/**
 * Pure policy for the public billing webhook endpoint. No I/O, so it can be
 * tested — unlike the route handler it is called from.
 */

/**
 * The exact body PayTR requires in order to consider a notification delivered.
 * Anything else is treated as a failed notification and retried on their
 * schedule, so this must never be sent for a payload we did not persist.
 */
export const BILLING_ACKNOWLEDGEMENT_BODY = "OK";

/**
 * Whether a notification from the named provider may be processed at all.
 *
 * The fake provider verifies no signature — it accepts any JSON body carrying a
 * merchantOid. Since the webhook route is public and a workspace member can read
 * their own charge-attempt id, allowing that anywhere but a developer machine
 * would let any member self-activate their own subscription. Default deny.
 */
export function allowsProviderWebhook(
  providerName: string,
  deploymentMode: "local" | "preview" | "production"
): boolean {
  return providerName !== "fake" || deploymentMode === "local";
}
