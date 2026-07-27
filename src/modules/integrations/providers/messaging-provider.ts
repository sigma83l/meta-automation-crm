import type { Result } from "@/src/lib/result";
import type { SendAuthorization } from "@/src/modules/integrations/live-send-gate";

export type MessagingChannel = "whatsapp" | "instagram";

export type InboundFixture = Readonly<{
  eventId: string;
  workspaceId: string;
  senderRef: string;
  text: string;
  receivedAt: string;
}>;

export type NormalizedInboundMessage = Readonly<{
  eventId: string;
  channel: MessagingChannel;
  workspaceId: string;
  senderRef: string;
  text: string;
  receivedAt: string;
  synthetic: true;
}>;

export type OutboundCommand = Readonly<{
  workspaceId: string;
  recipientRef: string;
  text: string;
  idempotencyKey: string;
  authorization: SendAuthorization;
}>;

export type OutboundReceipt = Readonly<{
  providerMessageId: string;
  channel: MessagingChannel;
  idempotencyKey: string;
  synthetic: true;
}>;

export interface MessagingProvider {
  readonly channel: MessagingChannel;
  normalizeInbound(fixture: InboundFixture): Result<NormalizedInboundMessage>;
  send(command: OutboundCommand): Promise<Result<OutboundReceipt>>;
}
