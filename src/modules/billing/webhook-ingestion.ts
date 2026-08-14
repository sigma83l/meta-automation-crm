import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider, VerifiedBillingWebhookEvent } from "./contracts";

export type BillingIngestionResult = Readonly<{
  result: "accepted" | "duplicate" | "unknown_charge_attempt";
  webhookEventId?: string;
  trustedWorkspaceId?: string;
}>;

export interface BillingWebhookRepository {
  ingest(event: VerifiedBillingWebhookEvent): Promise<BillingIngestionResult>;
}

export class SupabaseBillingWebhookRepository implements BillingWebhookRepository {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly providerName: "paytr" | "fake"
  ) {}

  async ingest(event: VerifiedBillingWebhookEvent): Promise<BillingIngestionResult> {
    const { data, error } = await this.admin.rpc("ingest_billing_webhook_event", {
      p_provider: this.providerName,
      p_provider_event_ref: event.eventRef,
      p_charge_attempt_id: event.chargeAttemptId,
      p_event_type: event.eventType,
      p_safe_payload: event.safePayload,
      p_occurred_at: new Date().toISOString()
    });
    if (error) throw new Error("Billing webhook persistence failed.");
    const row = (
      data as readonly {
        result: BillingIngestionResult["result"];
        webhook_event_id: string | null;
        trusted_workspace_id: string | null;
      }[]
    )[0]!;
    return {
      result: row.result,
      ...(row.webhook_event_id ? { webhookEventId: row.webhook_event_id } : {}),
      ...(row.trusted_workspace_id ? { trustedWorkspaceId: row.trusted_workspace_id } : {})
    };
  }
}

export async function ingestVerifiedBillingWebhook(
  provider: PaymentProvider,
  input: Readonly<{ rawBody: Uint8Array; headers: Readonly<Record<string, string>> }>,
  repository: BillingWebhookRepository
) {
  const verification = provider.verifyAndParseWebhook(input);
  if (!verification.ok) {
    return { acknowledged: false as const, status: "invalid_payload" as const };
  }
  const result = await repository.ingest(verification.value);
  return {
    acknowledged: true as const,
    status: result.result,
    event: verification.value,
    ...result
  };
}
