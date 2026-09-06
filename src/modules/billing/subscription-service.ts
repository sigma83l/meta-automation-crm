import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { getServerEnvironment } from "@/src/lib/env";
import {
  assertWorkspaceManager,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import { encryptCredential } from "@/src/modules/ai/credential-vault";
import type {
  BillingStatus,
  ChargeOutcome,
  PaymentProvider,
  SubscriptionStatus
} from "./contracts";
import type { BillingActionAuthorization } from "./live-billing-gate";
import {
  createSignedBillingCallbackState,
  verifySignedBillingCallbackState
} from "./callback-state";
import { checkAndRecordTrialFingerprint } from "./trial-policy";
import { isTrialGrantable } from "./renewal-policy";
import { createFakePaymentProvider } from "./providers/fake-payment-provider";
import { createPaytrPaymentProvider } from "./providers/paytr-payment-provider";

export function resolvePaymentProvider(): PaymentProvider {
  const env = getServerEnvironment();
  switch (env.paymentProviderMode) {
    case "paytr": {
      if (!env.paytrMerchantId || !env.paytrMerchantKey || !env.paytrMerchantSalt) {
        throw new Error("PayTR merchant credentials are not configured.");
      }
      return createPaytrPaymentProvider({
        merchantId: env.paytrMerchantId,
        merchantKey: env.paytrMerchantKey,
        merchantSalt: env.paytrMerchantSalt
      });
    }
    case "paddle":
      // The Paddle webhook and authority path exist; the PaymentProvider
      // adapter does not, because there is no account to build it against yet.
      // Refusing here is the point: falling through to the fake provider would
      // mean a deployment configured for Paddle quietly ran on an adapter that
      // verifies no signature and treats itself as sandbox.
      throw new Error("Paddle mode is configured but no Paddle payment adapter is available yet.");
    case "fake":
      return createFakePaymentProvider();
  }
}

function billingAuthorization(): BillingActionAuthorization {
  const env = getServerEnvironment();
  return {
    // Anything that is not the fake adapter is a live money path. Naming the
    // one sandbox mode rather than listing the live ones means a provider added
    // later defaults to live, which is the safe direction to be wrong in.
    mode: env.paymentProviderMode === "fake" ? "sandbox" : "live",
    environmentEnabled: env.liveBillingEnabled,
    explicitApproval: env.billingLiveApproved,
    merchantAllowlisted: env.paymentProviderMode === "paytr" ? Boolean(env.paytrMerchantId) : true
  };
}

function callbackSecret(): string {
  const env = getServerEnvironment();
  if (!env.billingCallbackStateSecret) throw new Error("Billing callback signing is unavailable.");
  return env.billingCallbackStateSecret;
}

/**
 * PayTR's request-signing hash includes the account email; fetched fresh
 * from the canonical auth.users record rather than duplicated into a
 * billing table, so no additional PII is persisted for this purpose.
 */
async function workspaceOwnerEmail(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("Workspace owner email is unavailable.");
  return data.user.email;
}

export async function createCardRegistrationState(workspaceId: string) {
  const issuedAt = Date.now();
  const state = createSignedBillingCallbackState(
    workspaceId,
    "card_registration",
    callbackSecret(),
    issuedAt
  );
  const admin = await createSupabaseAdminClient();
  const { error } = await admin.from("billing_callback_nonces").upsert(
    {
      workspace_id: workspaceId,
      purpose: "card_registration",
      state_hash: createHash("sha256").update(state).digest("hex"),
      expires_at: new Date(issuedAt + 600_000).toISOString(),
      consumed_at: null
    },
    { onConflict: "workspace_id,purpose" }
  );
  if (error) throw new Error("Billing callback state could not be stored.");
  return state;
}

export function verifyCardRegistrationState(
  state: string,
  workspaceId: string,
  maxAgeMs = 600_000
) {
  return verifySignedBillingCallbackState(
    state,
    workspaceId,
    "card_registration",
    callbackSecret(),
    Date.now(),
    maxAgeMs
  );
}

export async function consumeCardRegistrationState(state: string, workspaceId: string) {
  if (!verifyCardRegistrationState(state, workspaceId)) return false;
  const admin = await createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_billing_callback_nonce", {
    p_workspace_id: workspaceId,
    p_purpose: "card_registration",
    p_state_hash: createHash("sha256").update(state).digest("hex")
  });
  return !error && data === true;
}

export async function startCardRegistration(
  workspace: TrustedWorkspace,
  returnUrl: string,
  userIp: string
) {
  assertWorkspaceManager(workspace);
  const provider = resolvePaymentProvider();
  const admin = await createSupabaseAdminClient();
  const [state, customerEmail] = await Promise.all([
    createCardRegistrationState(workspace.id),
    workspaceOwnerEmail(admin, workspace.userId)
  ]);
  const separator = returnUrl.includes("?") ? "&" : "?";
  const result = await provider.initCardRegistration({
    workspaceId: workspace.id,
    returnUrl: `${returnUrl}${separator}state=${encodeURIComponent(state)}`,
    customerRef: workspace.id,
    customerEmail,
    userIp,
    authorization: billingAuthorization()
  });
  if (!result.ok) throw new Error(result.error.message);

  // Persist the provider's session ref (PayTR's merchant_oid). This row is the
  // only thing that can later bind a signature-verified server-to-server
  // notification back to a workspace: the notification payload must never be
  // allowed to select a tenant itself (same rule as ingest_meta_event, D-017).
  const { error: sessionError } = await admin.from("billing_card_registration_sessions").insert({
    workspace_id: workspace.id,
    provider: provider.providerName,
    provider_session_ref: result.value.providerSessionRef,
    initiated_by: workspace.userId,
    status: "pending",
    expires_at: new Date(Date.now() + CARD_REGISTRATION_SESSION_TTL_MS).toISOString()
  });
  if (sessionError) throw new Error("Card registration session could not be recorded.");

  return { redirectUrl: result.value.redirectUrl, state };
}

/**
 * Claims this workspace's pending card-registration session exactly once.
 *
 * A single guarded UPDATE, so two concurrent callbacks cannot both win. Returns
 * null when there is no live pending session, which makes a replayed or
 * fabricated callback a no-op rather than a registration.
 */
async function claimCardRegistrationSession(admin: SupabaseClient, workspaceId: string) {
  const { data, error } = await admin
    .from("billing_card_registration_sessions")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .gte("expires_at", new Date().toISOString())
    .select("id,provider,provider_session_ref")
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; provider: string; provider_session_ref: string };
}

async function getSubscriptionId(admin: SupabaseClient, workspaceId: string): Promise<string> {
  const { data, error } = await admin
    .from("workspace_subscriptions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !data) throw new Error("Workspace subscription is missing.");
  return data.id as string;
}

async function transitionSubscription(
  admin: SupabaseClient,
  workspaceId: string,
  status: SubscriptionStatus,
  planId: string | null,
  trialEndsAt: string | null,
  currentPeriodEndsAt: string | null
) {
  const { data, error } = await admin.rpc("transition_workspace_subscription", {
    trusted_workspace_id: workspaceId,
    trusted_new_status: status,
    trusted_plan_id: planId,
    trusted_trial_ends_at: trialEndsAt,
    trusted_current_period_ends_at: currentPeriodEndsAt
  });
  if (error || data !== true) throw new Error("Subscription transition failed.");
}

async function recordAuditEvent(
  admin: SupabaseClient,
  workspace: TrustedWorkspace,
  eventType: string,
  status: string,
  safeDetails: Record<string, unknown>
) {
  await admin.from("billing_audit_events").insert({
    workspace_id: workspace.id,
    actor_id: workspace.userId,
    event_type: eventType,
    status,
    safe_details: safeDetails
  });
}

async function recordChargeAttempt(
  admin: SupabaseClient,
  workspaceId: string,
  subscriptionId: string
): Promise<{ id: string }> {
  const { count } = await admin
    .from("billing_charge_attempts")
    .select("id", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId);
  const { data, error } = await admin
    .from("billing_charge_attempts")
    .insert({
      workspace_id: workspaceId,
      subscription_id: subscriptionId,
      attempt_number: (count ?? 0) + 1,
      status: "pending"
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Charge attempt could not be recorded.");
  return { id: data.id as string };
}

async function resolveChargeAttempt(
  admin: SupabaseClient,
  attemptId: string,
  outcome: ChargeOutcome
) {
  const status = outcome.status === "unknown" ? "charge_unknown" : outcome.status;
  const { error } = await admin
    .from("billing_charge_attempts")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      ...(outcome.providerTransactionRef
        ? { provider_transaction_ref: outcome.providerTransactionRef }
        : {})
    })
    .eq("id", attemptId);
  if (error) throw new Error("Charge attempt could not be resolved.");
}

export type CardRegistrationOutcome =
  | Readonly<{ outcome: "trialing"; trialEndsAt: string }>
  | Readonly<{ outcome: "active"; trialEndsAt: null }>
  | Readonly<{ outcome: "payment_required"; trialEndsAt: null }>
  /**
   * The provider's redirect is not proof of anything (see `CallbackAuthority`).
   * The registration stays pending until a signature-verified provider
   * notification confirms it. No card is stored and no entitlement is granted.
   */
  | Readonly<{ outcome: "pending_confirmation"; trialEndsAt: null }>;

/** Card-registration sessions outlive the signed state slightly, to leave room
 * for a provider notification that arrives just after the browser returns. */
const CARD_REGISTRATION_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Completes a verified card registration. Assumes the caller (the callback
 * route) has already consumed the single-use signed state before invoking
 * this — mirrors createLiveMetaConnection, which likewise trusts the route
 * to have consumed the OAuth nonce first.
 *
 * Trial fingerprint reuse policy (confirmed product decision): a card that
 * already consumed a trial elsewhere does NOT block registration — it skips
 * the trial and charges the plan price immediately instead, so a legitimate
 * customer (e.g. a second business on the same card) can still pay, while a
 * repeat-signup abuser never gets a second free trial.
 */
export async function completeCardRegistration(
  workspace: TrustedWorkspace,
  input: Readonly<{ rawBody: Uint8Array; query: Readonly<Record<string, string>> }>,
  userIp: string
): Promise<CardRegistrationOutcome> {
  assertWorkspaceManager(workspace);
  const provider = resolvePaymentProvider();
  const admin = await createSupabaseAdminClient();

  // Bind this callback to a registration this workspace actually started, and
  // claim it exactly once. Without a live pending session there is nothing to
  // complete — a replayed or hand-crafted callback stops here.
  const session = await claimCardRegistrationSession(admin, workspace.id);
  if (!session) {
    await recordAuditEvent(admin, workspace, "billing.card_registration_unclaimed", "blocked", {});
    return { outcome: "pending_confirmation", trialEndsAt: null };
  }

  // Fail closed for any provider whose redirect is not self-authenticating.
  // The session stays in `processing` for a verified provider notification to
  // finish; nothing is stored and no entitlement is granted from this request.
  if (provider.callbackAuthority === "requires_provider_confirmation") {
    await recordAuditEvent(
      admin,
      workspace,
      "billing.card_registration_awaiting_confirmation",
      "blocked",
      {}
    );
    return { outcome: "pending_confirmation", trialEndsAt: null };
  }

  const registration = await provider.verifyCardRegistrationCallback(input);
  if (!registration.ok) {
    await admin
      .from("billing_card_registration_sessions")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", session.id);
    await recordAuditEvent(admin, workspace, "billing.card_registration_failed", "failure", {});
    throw new Error(registration.error.message);
  }

  const fingerprint = await checkAndRecordTrialFingerprint(
    admin,
    workspace.id,
    registration.value.cardFingerprintSource
  );

  const env = getServerEnvironment();
  if (!env.credentialEncryptionKey) throw new Error("Token encryption is unavailable.");
  const customerEnvelope = encryptCredential(
    registration.value.providerCustomerRef,
    env.credentialEncryptionKey
  );
  const cardEnvelope = encryptCredential(
    registration.value.providerCardRef,
    env.credentialEncryptionKey
  );

  const { error: replaceError } = await admin
    .from("billing_payment_methods")
    .update({ status: "replaced" })
    .eq("workspace_id", workspace.id)
    .eq("status", "active");
  if (replaceError) throw new Error("Existing payment method could not be replaced.");

  const { error: insertError } = await admin.from("billing_payment_methods").insert({
    workspace_id: workspace.id,
    provider: provider.providerName,
    provider_customer_ref_ciphertext: customerEnvelope.ciphertext,
    provider_customer_ref_iv: customerEnvelope.iv,
    provider_customer_ref_auth_tag: customerEnvelope.authTag,
    provider_card_ref_ciphertext: cardEnvelope.ciphertext,
    provider_card_ref_iv: cardEnvelope.iv,
    provider_card_ref_auth_tag: cardEnvelope.authTag,
    key_version: customerEnvelope.keyVersion,
    masked_card_suffix: registration.value.maskedCardSuffix,
    card_brand: registration.value.cardBrand ?? null,
    status: "active"
  });
  if (insertError) throw new Error("Payment method could not be stored.");

  await admin
    .from("billing_card_registration_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", session.id);

  // A workspace gets one trial ever, independent of how many cards it presents.
  // The database enforces this too (transition_workspace_subscription raises on
  // a second grant); checking here means a repeat workspace is charged normally
  // rather than hitting that exception.
  const { data: subscriptionRow } = await admin
    .from("workspace_subscriptions")
    .select("trial_consumed_at")
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const trialConsumedAt = (subscriptionRow?.trial_consumed_at as string | null) ?? null;

  if (isTrialGrantable(fingerprint.isNew, trialConsumedAt)) {
    const trialEndsAt = new Date(Date.now() + env.billingTrialDays * 86_400_000).toISOString();
    await transitionSubscription(admin, workspace.id, "trialing", null, trialEndsAt, null);
    await recordAuditEvent(admin, workspace, "billing.trial_started", "success", {});
    return { outcome: "trialing", trialEndsAt };
  }

  await recordAuditEvent(
    admin,
    workspace,
    trialConsumedAt ? "billing.workspace_trial_reused" : "billing.trial_fingerprint_reused",
    "flagged",
    {}
  );
  const subscriptionId = await getSubscriptionId(admin, workspace.id);
  const attempt = await recordChargeAttempt(admin, workspace.id, subscriptionId);
  const customerEmail = await workspaceOwnerEmail(admin, workspace.userId);
  const charge = await provider.chargeStoredCard({
    providerCustomerRef: registration.value.providerCustomerRef,
    providerCardRef: registration.value.providerCardRef,
    amountMinorUnits: env.billingPlanPriceMinorUnits,
    currency: "TRY",
    orderRef: attempt.id,
    customerEmail,
    userIp,
    authorization: billingAuthorization()
  });
  if (!charge.ok) {
    await recordAuditEvent(admin, workspace, "billing.immediate_charge_failed", "failure", {});
    return { outcome: "payment_required", trialEndsAt: null };
  }
  await resolveChargeAttempt(admin, attempt.id, charge.value);

  if (charge.value.status !== "succeeded") {
    await recordAuditEvent(admin, workspace, "billing.immediate_charge_failed", "failure", {});
    return { outcome: "payment_required", trialEndsAt: null };
  }

  const currentPeriodEndsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await transitionSubscription(admin, workspace.id, "active", null, null, currentPeriodEndsAt);
  await recordAuditEvent(admin, workspace, "billing.activated_without_trial", "success", {});
  return { outcome: "active", trialEndsAt: null };
}

export async function getBillingStatus(workspace: TrustedWorkspace): Promise<BillingStatus> {
  const admin = await createSupabaseAdminClient();
  const { data: subscription, error: subscriptionError } = await admin
    .from("workspace_subscriptions")
    .select("status,trial_ends_at,current_period_ends_at,canceled_at,plan_id")
    .eq("workspace_id", workspace.id)
    .single();
  if (subscriptionError || !subscription) throw new Error("Subscription is unavailable.");

  const { data: plan } = await admin
    .from("subscription_plans")
    .select("display_name,price_minor_units,currency")
    .eq("id", subscription.plan_id)
    .maybeSingle();

  const { data: paymentMethod } = await admin
    .from("billing_payment_methods")
    .select("provider,masked_card_suffix,card_brand")
    .eq("workspace_id", workspace.id)
    .eq("status", "active")
    .maybeSingle();

  const trialEndsAt = subscription.trial_ends_at as string | null;
  return {
    status: subscription.status as SubscriptionStatus,
    planDisplayName: plan?.display_name ?? "Standard",
    priceMinorUnits: plan?.price_minor_units ?? 0,
    currency: plan?.currency ?? "TRY",
    trialEndsAt,
    trialDaysLeft: trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
      : null,
    currentPeriodEndsAt: subscription.current_period_ends_at,
    canceledAt: subscription.canceled_at,
    paymentMethod: paymentMethod
      ? {
          provider: paymentMethod.provider,
          maskedCardSuffix: paymentMethod.masked_card_suffix,
          cardBrand: paymentMethod.card_brand
        }
      : null
  };
}

export async function cancelSubscription(workspace: TrustedWorkspace) {
  assertWorkspaceManager(workspace);
  const admin = await createSupabaseAdminClient();
  await transitionSubscription(admin, workspace.id, "canceled", null, null, null);
  await recordAuditEvent(admin, workspace, "billing.subscription_canceled", "success", {});
}
