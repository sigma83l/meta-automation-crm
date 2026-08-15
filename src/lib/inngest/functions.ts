import "server-only";

import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { decryptCredential } from "@/src/modules/ai/credential-vault";
import { resolvePaymentProvider } from "@/src/modules/billing/subscription-service";
import {
  BILLING_MAX_CHARGE_ATTEMPTS,
  TRIAL_GRACE_MS,
  buildDueSubscriptionFilter,
  countConsecutiveFailures,
  graceHasLapsed,
  hasExhaustedChargeAttempts,
  stateForUnchargeableTrial,
  trialEndAfterTransition
} from "@/src/modules/billing/renewal-policy";
import { inngest } from "./client";

export const relayMetaOutbox = inngest.createFunction(
  {
    id: "relay-meta-event-outbox",
    retries: 5,
    concurrency: { limit: 1 },
    triggers: { cron: "* * * * *" }
  },
  async ({ step }) => {
    const rows = await step.run("claim-pending-outbox", async () => {
      const admin = await createSupabaseAdminClient();
      const { data, error } = await admin
        .from("provider_event_outbox")
        .select("id,workspace_id,payload,attempts")
        .is("emitted_at", null)
        .lt("attempts", 10)
        .order("created_at")
        .limit(100);
      if (error) throw new Error("OUTBOX_READ_FAILED");
      return data ?? [];
    });

    for (const row of rows) {
      await step.run(`emit-${row.id}`, async () => {
        const payload = row.payload as Record<string, unknown>;
        await inngest.send({
          id: String(payload.webhookEventId ?? row.id),
          name: "meta/webhook.received",
          data: payload
        });
        const admin = await createSupabaseAdminClient();
        const { error } = await admin
          .from("provider_event_outbox")
          .update({
            emitted_at: new Date().toISOString(),
            attempts: Number(row.attempts) + 1
          })
          .eq("id", row.id)
          .eq("workspace_id", row.workspace_id)
          .is("emitted_at", null);
        if (error) throw new Error("OUTBOX_MARK_FAILED");
      });
    }
    return { emitted: rows.length };
  }
);

export const processVerifiedMetaEvent = inngest.createFunction(
  {
    id: "process-verified-meta-event",
    retries: 5,
    concurrency: [{ limit: 4, key: "event.data.trustedWorkspaceId" }],
    triggers: { event: "meta/webhook.received" }
  },
  async ({ event, step }) =>
    step.run("verify-trusted-routing-record", async () => {
      const data = event.data as Record<string, unknown>;
      const webhookEventId = String(data.webhookEventId ?? "");
      const trustedWorkspaceId = String(data.trustedWorkspaceId ?? "");
      const admin = await createSupabaseAdminClient();
      const { data: row, error } = await admin
        .from("meta_webhook_events")
        .select("id,workspace_id,processing_status")
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .single();
      if (error || !row) throw new Error("TRUSTED_WEBHOOK_ROUTE_NOT_FOUND");
      const updated = await admin
        .from("meta_webhook_events")
        .update({ processing_status: "processed" })
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .eq("processing_status", "accepted");
      if (updated.error) throw new Error("WEBHOOK_PROCESSING_MARK_FAILED");
      return { webhookEventId, trustedWorkspaceId };
    })
);

export const cleanupExpiredPrivateArtifacts = inngest.createFunction(
  {
    id: "cleanup-expired-private-artifacts",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: { cron: "17 3 * * *" }
  },
  async ({ step }) => {
    const removedRateLimits = await step.run("purge-rate-limits", async () => {
      const admin = await createSupabaseAdminClient();
      const { data, error } = await admin.rpc("purge_expired_auth_rate_limits", {
        requested_limit: 10_000
      });
      if (error) throw new Error("RATE_LIMIT_CLEANUP_FAILED");
      return Number(data ?? 0);
    });
    const removedBillingNonces = await step.run("purge-billing-nonces", async () => {
      const admin = await createSupabaseAdminClient();
      const { data, error } = await admin.rpc("purge_orphaned_billing_nonces", {
        requested_limit: 10_000
      });
      if (error) throw new Error("BILLING_NONCE_CLEANUP_FAILED");
      return Number(data ?? 0);
    });
    const expiredExports = await step.run("expire-private-exports", async () => {
      const admin = await createSupabaseAdminClient();
      const { data, error } = await admin
        .from("export_jobs")
        .select("id,workspace_id,object_path")
        .in("status", ["ready", "failed"])
        .lte("expires_at", new Date().toISOString())
        .limit(250);
      if (error) throw new Error("EXPORT_CLEANUP_READ_FAILED");
      let removed = 0;
      for (const job of data ?? []) {
        if (job.object_path) {
          const storage = await admin.storage.from("crm-private").remove([job.object_path]);
          if (storage.error) throw new Error("EXPORT_OBJECT_CLEANUP_FAILED");
        }
        const update = await admin
          .from("export_jobs")
          .update({ status: "expired", object_path: null })
          .eq("id", job.id)
          .eq("workspace_id", job.workspace_id);
        if (update.error) throw new Error("EXPORT_CLEANUP_MARK_FAILED");
        removed += 1;
      }
      return removed;
    });
    return { removedRateLimits, removedBillingNonces, expiredExports };
  }
);

export const relayBillingOutbox = inngest.createFunction(
  {
    id: "relay-billing-outbox",
    retries: 5,
    concurrency: { limit: 1 },
    triggers: { cron: "* * * * *" }
  },
  async ({ step }) => {
    const rows = await step.run("claim-pending-billing-outbox", async () => {
      const admin = await createSupabaseAdminClient();
      const { data, error } = await admin
        .from("billing_provider_event_outbox")
        .select("id,workspace_id,payload,attempts")
        .is("emitted_at", null)
        .lt("attempts", 10)
        .order("created_at")
        .limit(100);
      if (error) throw new Error("BILLING_OUTBOX_READ_FAILED");
      return data ?? [];
    });

    for (const row of rows) {
      await step.run(`emit-${row.id}`, async () => {
        const payload = row.payload as Record<string, unknown>;
        await inngest.send({
          id: String(payload.webhookEventId ?? row.id),
          name: "billing/webhook.received",
          data: payload
        });
        const admin = await createSupabaseAdminClient();
        const { error } = await admin
          .from("billing_provider_event_outbox")
          .update({
            emitted_at: new Date().toISOString(),
            attempts: Number(row.attempts) + 1
          })
          .eq("id", row.id)
          .eq("workspace_id", row.workspace_id)
          .is("emitted_at", null);
        if (error) throw new Error("BILLING_OUTBOX_MARK_FAILED");
      });
    }
    return { emitted: rows.length };
  }
);

export const processVerifiedBillingWebhook = inngest.createFunction(
  {
    id: "process-verified-billing-webhook",
    retries: 5,
    concurrency: [{ limit: 4, key: "event.data.trustedWorkspaceId" }],
    triggers: { event: "billing/webhook.received" }
  },
  async ({ event, step }) =>
    step.run("apply-billing-webhook-consequence", async () => {
      const data = event.data as Record<string, unknown>;
      const webhookEventId = String(data.webhookEventId ?? "");
      const trustedWorkspaceId = String(data.trustedWorkspaceId ?? "");
      const chargeAttemptId = String(data.chargeAttemptId ?? "");
      const admin = await createSupabaseAdminClient();

      const { data: webhookRow, error: webhookError } = await admin
        .from("billing_webhook_events")
        .select("id,workspace_id,event_type,processing_status")
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .single();
      if (webhookError || !webhookRow) throw new Error("TRUSTED_BILLING_WEBHOOK_NOT_FOUND");

      const marked = await admin
        .from("billing_webhook_events")
        .update({ processing_status: "processed" })
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .eq("processing_status", "accepted");
      if (marked.error) throw new Error("BILLING_WEBHOOK_MARK_FAILED");

      const { data: attempt, error: attemptError } = await admin
        .from("billing_charge_attempts")
        .select("id,workspace_id,subscription_id")
        .eq("id", chargeAttemptId)
        .eq("workspace_id", trustedWorkspaceId)
        .single();
      if (attemptError || !attempt) throw new Error("TRUSTED_CHARGE_ATTEMPT_NOT_FOUND");

      const succeeded = webhookRow.event_type === "charge.succeeded";
      await admin
        .from("billing_charge_attempts")
        .update({
          status: succeeded ? "succeeded" : "declined",
          resolved_at: new Date().toISOString()
        })
        .eq("id", attempt.id)
        .eq("workspace_id", trustedWorkspaceId);

      const { data: subscription } = await admin
        .from("workspace_subscriptions")
        .select("plan_id,trial_ends_at,current_period_ends_at")
        .eq("id", attempt.subscription_id)
        .eq("workspace_id", trustedWorkspaceId)
        .single();

      const { data: transitioned, error: transitionError } = await admin.rpc(
        "transition_workspace_subscription",
        {
          trusted_workspace_id: trustedWorkspaceId,
          trusted_new_status: succeeded ? "active" : "past_due",
          trusted_plan_id: subscription?.plan_id ?? null,
          // Same conversion rule as the cron path: a successful charge ends the
          // trial for good. Preserving it here re-armed the identical re-charge
          // loop through the webhook route.
          trusted_trial_ends_at: trialEndAfterTransition(
            succeeded,
            subscription?.trial_ends_at ?? null
          ),
          trusted_current_period_ends_at: succeeded
            ? new Date(Date.now() + 30 * 86_400_000).toISOString()
            : (subscription?.current_period_ends_at ?? null)
        }
      );
      if (transitionError || transitioned !== true)
        throw new Error("BILLING_SUBSCRIPTION_TRANSITION_FAILED");

      return { webhookEventId, trustedWorkspaceId, outcome: succeeded ? "active" : "past_due" };
    })
);

/**
 * How long an attempt may sit unresolved before the scheduler treats it as
 * money it cannot account for. Long enough not to race the interactive
 * registration path, which resolves its own attempt immediately.
 */
const UNRESOLVED_ATTEMPT_GRACE_MS = 10 * 60 * 1000;

export const chargeDueTrialsAndSubscriptions = inngest.createFunction(
  {
    id: "charge-due-trials-and-subscriptions",
    retries: 5,
    concurrency: { limit: 1 },
    triggers: { cron: "*/15 * * * *" }
  },
  async ({ step }) => {
    const due = await step.run("claim-due-subscriptions", async () => {
      const admin = await createSupabaseAdminClient();
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from("workspace_subscriptions")
        .select("id,workspace_id,status,trial_ends_at,current_period_ends_at,grace_ends_at,plan_id")
        .or(buildDueSubscriptionFilter(nowIso))
        .limit(100);
      if (error) throw new Error("DUE_SUBSCRIPTIONS_READ_FAILED");
      return data ?? [];
    });

    let charged = 0;
    let skipped = 0;
    for (const row of due) {
      // Three separate steps, deliberately. Inngest memoises each completed
      // step, so a failure in a later one replays the earlier results instead
      // of re-running them. Previously the whole sequence — reserve, charge,
      // record — lived in a single step with retries: 5, so any error *after*
      // the provider had taken the money (a Supabase timeout on the status
      // write, a transient RPC failure) replayed the charge against a brand new
      // orderRef, defeating the provider's own order deduplication. This is the
      // sent_unknown rule in AGENTS.md applied to money.

      // Step 1 — decide and reserve. No provider contact.
      const prepared = await step.run(`prepare-charge-${row.id}`, async () => {
        const admin = await createSupabaseAdminClient();

        const { data: lastAttempt } = await admin
          .from("billing_charge_attempts")
          .select("id,status,created_at")
          .eq("subscription_id", row.id)
          .order("attempt_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        // A grace window that has closed ends the subscription. Checked before
        // anything else: there is nothing to charge and nothing to retry.
        if (row.status === "trial_expired_grace") {
          if (graceHasLapsed((row.grace_ends_at as string | null) ?? null)) {
            await admin.rpc("transition_workspace_subscription", {
              trusted_workspace_id: row.workspace_id,
              trusted_new_status: "canceled",
              trusted_plan_id: row.plan_id,
              trusted_trial_ends_at: row.trial_ends_at,
              trusted_current_period_ends_at: row.current_period_ends_at,
              trusted_grace_ends_at: null
            });
          }
          return { action: "skip" as const };
        }

        if (lastAttempt?.status === "charge_unknown") {
          // Ambiguous prior outcome — requires manual reconciliation before
          // any further automated attempt.
          return { action: "skip" as const };
        }

        // An attempt still 'pending' on a later tick is money we cannot account
        // for: the provider may or may not have taken it. Never retry it
        // automatically. Past a grace window (so we do not race the interactive
        // registration path, which resolves its own attempt immediately) it is
        // promoted to charge_unknown so it surfaces for reconciliation.
        if (lastAttempt?.status === "pending") {
          const startedAt = Date.parse(String(lastAttempt.created_at ?? ""));
          if (Number.isFinite(startedAt) && Date.now() - startedAt > UNRESOLVED_ATTEMPT_GRACE_MS) {
            await admin
              .from("billing_charge_attempts")
              .update({ status: "charge_unknown", resolved_at: new Date().toISOString() })
              .eq("id", lastAttempt.id);
          }
          return { action: "skip" as const };
        }

        const { data: recentAttempts } = await admin
          .from("billing_charge_attempts")
          .select("status")
          .eq("subscription_id", row.id)
          .order("attempt_number", { ascending: false })
          .limit(BILLING_MAX_CHARGE_ATTEMPTS + 1);

        if (hasExhaustedChargeAttempts(countConsecutiveFailures(recentAttempts ?? []))) {
          await admin.rpc("transition_workspace_subscription", {
            trusted_workspace_id: row.workspace_id,
            trusted_new_status: "canceled",
            trusted_plan_id: row.plan_id,
            trusted_trial_ends_at: row.trial_ends_at,
            trusted_current_period_ends_at: row.current_period_ends_at
          });
          return { action: "skip" as const };
        }

        const { data: paymentMethod } = await admin
          .from("billing_payment_methods")
          .select("id")
          .eq("workspace_id", row.workspace_id)
          .eq("status", "active")
          .maybeSingle();
        if (!paymentMethod) {
          // Without a stored card there is nothing to attempt. A trial gets a
          // deadline-bounded grace window; anything else is genuinely past due.
          const nextStatus = stateForUnchargeableTrial(row.status !== "trialing");
          await admin.rpc("transition_workspace_subscription", {
            trusted_workspace_id: row.workspace_id,
            trusted_new_status: nextStatus,
            trusted_plan_id: row.plan_id,
            trusted_trial_ends_at: row.trial_ends_at,
            trusted_current_period_ends_at: row.current_period_ends_at,
            trusted_grace_ends_at:
              nextStatus === "trial_expired_grace"
                ? new Date(Date.now() + TRIAL_GRACE_MS).toISOString()
                : null
          });
          return { action: "skip" as const };
        }

        // attempt_number is a monotonic sequence: it must keep increasing to
        // satisfy unique (subscription_id, attempt_number).
        const { count } = await admin
          .from("billing_charge_attempts")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", row.id);

        const { data: attempt, error: attemptError } = await admin
          .from("billing_charge_attempts")
          .insert({
            workspace_id: row.workspace_id,
            subscription_id: row.id,
            attempt_number: (count ?? 0) + 1,
            status: "pending"
          })
          .select("id")
          .single();
        if (attemptError || !attempt) throw new Error("CHARGE_ATTEMPT_RECORD_FAILED");

        return { action: "charge" as const, attemptId: String(attempt.id) };
      });

      if (prepared.action === "skip") {
        skipped += 1;
        continue;
      }

      // Step 2 — the irreversible call, isolated so nothing downstream can
      // cause it to happen twice. orderRef is the reserved attempt id, so it is
      // stable across replays and the provider's own dedupe still applies.
      // Card tokens and the owner's email are resolved inside this step and
      // never returned: a step's return value is persisted by Inngest, and
      // neither secrets nor real PII may leave the process.
      const outcome = await step.run(`execute-charge-${row.id}`, async () => {
        const admin = await createSupabaseAdminClient();
        const env = getServerEnvironment();
        if (!env.credentialEncryptionKey) throw new Error("BILLING_ENCRYPTION_UNAVAILABLE");

        const { data: paymentMethod } = await admin
          .from("billing_payment_methods")
          .select(
            "provider_customer_ref_ciphertext,provider_customer_ref_iv,provider_customer_ref_auth_tag,provider_card_ref_ciphertext,provider_card_ref_iv,provider_card_ref_auth_tag"
          )
          .eq("workspace_id", row.workspace_id)
          .eq("status", "active")
          .maybeSingle();
        if (!paymentMethod) return { status: "unknown" as const };

        const providerCustomerRef = decryptCredential(
          {
            ciphertext: paymentMethod.provider_customer_ref_ciphertext,
            iv: paymentMethod.provider_customer_ref_iv,
            authTag: paymentMethod.provider_customer_ref_auth_tag
          },
          env.credentialEncryptionKey
        );
        const providerCardRef = decryptCredential(
          {
            ciphertext: paymentMethod.provider_card_ref_ciphertext,
            iv: paymentMethod.provider_card_ref_iv,
            authTag: paymentMethod.provider_card_ref_auth_tag
          },
          env.credentialEncryptionKey
        );

        const { data: owner } = await admin
          .from("workspace_memberships")
          .select("user_id")
          .eq("workspace_id", row.workspace_id)
          .eq("role", "owner")
          .eq("status", "active")
          .maybeSingle();
        if (!owner) throw new Error("WORKSPACE_OWNER_NOT_FOUND");
        const { data: ownerAccount, error: ownerError } = await admin.auth.admin.getUserById(
          owner.user_id
        );
        if (ownerError || !ownerAccount.user?.email)
          throw new Error("WORKSPACE_OWNER_EMAIL_UNAVAILABLE");

        const provider = resolvePaymentProvider();
        const charge = await provider.chargeStoredCard({
          providerCustomerRef,
          providerCardRef,
          amountMinorUnits: env.billingPlanPriceMinorUnits,
          currency: "TRY",
          orderRef: prepared.attemptId,
          customerEmail: ownerAccount.user.email,
          // No live request context for a scheduled/background charge; a
          // real end-user IP genuinely doesn't exist here.
          userIp: "0.0.0.0",
          authorization: {
            mode: env.paymentProviderMode === "paytr" ? "live" : "sandbox",
            environmentEnabled: env.liveBillingEnabled,
            explicitApproval: env.billingLiveApproved,
            merchantAllowlisted:
              env.paymentProviderMode === "paytr" ? Boolean(env.paytrMerchantId) : true
          }
        });

        if (!charge.ok) return { status: "unknown" as const };
        return {
          status: charge.value.status,
          ...(charge.value.providerTransactionRef
            ? { providerTransactionRef: charge.value.providerTransactionRef }
            : {})
        };
      });

      // Step 3 — record the consequence. Writes only, so retrying it is safe
      // and can never reach the provider.
      await step.run(`record-charge-${row.id}`, async () => {
        const admin = await createSupabaseAdminClient();

        if (outcome.status === "succeeded") {
          await admin
            .from("billing_charge_attempts")
            .update({
              status: "succeeded",
              resolved_at: new Date().toISOString(),
              ...("providerTransactionRef" in outcome && outcome.providerTransactionRef
                ? { provider_transaction_ref: outcome.providerTransactionRef }
                : {})
            })
            .eq("id", prepared.attemptId);
          await admin.rpc("transition_workspace_subscription", {
            trusted_workspace_id: row.workspace_id,
            trusted_new_status: "active",
            trusted_plan_id: row.plan_id,
            // Clearing the trial end is what makes the conversion terminal. A
            // subscription that has converted is no longer trialing, so
            // carrying a past trial date forward would leave it permanently due.
            trusted_trial_ends_at: null,
            trusted_current_period_ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString()
          });
          return;
        }

        await admin
          .from("billing_charge_attempts")
          .update({
            status: outcome.status === "declined" ? "declined" : "charge_unknown",
            resolved_at: new Date().toISOString()
          })
          .eq("id", prepared.attemptId);
        await admin.rpc("transition_workspace_subscription", {
          trusted_workspace_id: row.workspace_id,
          trusted_new_status: "past_due",
          trusted_plan_id: row.plan_id,
          trusted_trial_ends_at: row.trial_ends_at,
          trusted_current_period_ends_at: row.current_period_ends_at
        });
      });

      charged += 1;
    }
    return { charged, skipped };
  }
);

export const inngestFunctions = [
  relayMetaOutbox,
  processVerifiedMetaEvent,
  cleanupExpiredPrivateArtifacts,
  relayBillingOutbox,
  processVerifiedBillingWebhook,
  chargeDueTrialsAndSubscriptions
] as const;
