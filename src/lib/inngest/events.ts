export type FoundationEventMap = {
  "app/health.checked": {
    data: {
      requestId: string;
      checkedAt: string;
    };
  };
  "sandbox/message.received": {
    data: {
      workspaceId: string;
      channel: "whatsapp" | "instagram";
      eventId: string;
      synthetic: true;
    };
  };
  "crm/export.requested": {
    data: {
      jobId: string;
      trustedWorkspaceId: string;
      requestedBy: string;
    };
  };
  "meta/webhook.received": {
    data: {
      webhookEventId: string;
      trustedWorkspaceId: string;
      channel: "whatsapp" | "instagram";
      providerEventId: string;
    };
  };
  "automation/run.requested": {
    data: {
      workspaceId: string;
      runId: string;
      provider: "instagram" | "whatsapp";
    };
  };
  "billing/webhook.received": {
    data: {
      webhookEventId: string;
      trustedWorkspaceId: string;
      chargeAttemptId: string;
      provider: "paytr" | "fake";
      providerEventRef: string;
    };
  };
};

export const inngestFoundationContract = Object.freeze({
  applicationId: "meta-automation-crm",
  registeredFunctions: 6,
  functionIds: Object.freeze([
    "relay-meta-event-outbox",
    "process-verified-meta-event",
    "cleanup-expired-private-artifacts",
    "relay-billing-outbox",
    "process-verified-billing-webhook",
    "charge-due-trials-and-subscriptions"
  ]),
  productionEnvironmentRequired: true
});
