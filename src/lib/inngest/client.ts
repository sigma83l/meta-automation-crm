import type { FoundationEventMap } from "@/src/lib/inngest/events";

export type InngestFoundationClient = Readonly<{
  id: "meta-automation-crm";
  eventNames: readonly (keyof FoundationEventMap)[];
  sdkAdapterRegistered: false;
}>;

export function createInngestFoundationClient(): InngestFoundationClient {
  return Object.freeze({
    id: "meta-automation-crm",
    eventNames: Object.freeze<(keyof FoundationEventMap)[]>([
      "app/health.checked",
      "sandbox/message.received",
      "crm/export.requested"
    ]),
    sdkAdapterRegistered: false
  });
}
