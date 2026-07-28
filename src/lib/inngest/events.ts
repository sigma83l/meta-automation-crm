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
};

export const inngestFoundationContract = Object.freeze({
  applicationId: "meta-automation-crm",
  registeredFunctions: 0,
  productionEnvironmentRequired: true
});
