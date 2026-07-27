import type { InboundFixture } from "@/src/modules/integrations/providers/messaging-provider";

export const syntheticWorkspace = Object.freeze({
  id: "ws_synthetic_northstar",
  name: "Northstar Studio"
});

export const syntheticInboundFixture: InboundFixture = Object.freeze({
  eventId: "evt_fixture_001",
  workspaceId: syntheticWorkspace.id,
  senderRef: "synthetic-contact-001",
  text: "Could you share the approved service details?",
  receivedAt: "2026-07-27T12:00:00.000Z"
});
