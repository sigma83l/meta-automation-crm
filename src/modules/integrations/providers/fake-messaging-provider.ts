import { appError, err, ok } from "@/src/lib/result";
import { authorizeOutboundSend } from "@/src/modules/integrations/live-send-gate";
import type {
  InboundFixture,
  MessagingChannel,
  MessagingProvider,
  OutboundCommand
} from "@/src/modules/integrations/providers/messaging-provider";

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function createFakeMessagingProvider(channel: MessagingChannel): MessagingProvider {
  return Object.freeze({
    channel,
    normalizeInbound(fixture: InboundFixture) {
      if (
        !nonEmpty(fixture.eventId) ||
        !nonEmpty(fixture.workspaceId) ||
        !nonEmpty(fixture.senderRef)
      ) {
        return err(
          appError("VALIDATION_ERROR", "Synthetic inbound fixture is missing an identifier.")
        );
      }

      const timestamp = new Date(fixture.receivedAt);
      if (Number.isNaN(timestamp.valueOf())) {
        return err(
          appError("VALIDATION_ERROR", "Synthetic inbound fixture has an invalid timestamp.")
        );
      }

      return ok(
        Object.freeze({
          eventId: fixture.eventId,
          channel,
          workspaceId: fixture.workspaceId,
          senderRef: fixture.senderRef,
          text: fixture.text,
          receivedAt: timestamp.toISOString(),
          synthetic: true as const
        })
      );
    },
    async send(command: OutboundCommand) {
      const authorization = authorizeOutboundSend(command.authorization);
      if (!authorization.ok) {
        return authorization;
      }
      if (authorization.value !== "SANDBOX") {
        return err(
          appError(
            "PROVIDER_UNAVAILABLE",
            "No real messaging adapter exists in the foundation stage."
          )
        );
      }
      if (
        !nonEmpty(command.workspaceId) ||
        !nonEmpty(command.recipientRef) ||
        !nonEmpty(command.idempotencyKey)
      ) {
        return err(appError("VALIDATION_ERROR", "Outbound command is missing an identifier."));
      }

      return ok(
        Object.freeze({
          providerMessageId: `fake-${channel}-${command.idempotencyKey}`,
          channel,
          idempotencyKey: command.idempotencyKey,
          synthetic: true as const
        })
      );
    }
  });
}
