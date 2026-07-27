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
};

export const inngestFoundationContract = Object.freeze({
  applicationId: "meta-automation-crm",
  registeredFunctions: 0,
  productionEnvironmentRequired: true
});
