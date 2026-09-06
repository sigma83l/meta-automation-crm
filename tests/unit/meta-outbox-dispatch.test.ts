import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import {
  dispatchAcceptedEvents,
  type MetaWebhookEvent
} from "@/src/modules/integrations/meta/outbox-dispatch";
import type { NormalizedMetaEvent } from "@/src/modules/integrations/meta/contracts";
import type { IngestionResult } from "@/src/modules/integrations/meta/webhook-ingestion";

/**
 * Direct dispatch, and what happens when it does not work.
 *
 * The happy path is the least interesting thing here. What matters is that a
 * failed send leaves the row for the relay, that a row is never marked emitted
 * before the send that emits it, and that nothing outside `accepted` is sent at
 * all — a duplicate or an unknown connection has no new message behind it.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

const event = (id: string): NormalizedMetaEvent => ({
  providerEventId: id,
  providerAccountId: "1285062738021361",
  channel: "whatsapp",
  type: "message",
  senderRef: "905550000001",
  text: "hello",
  attachments: [],
  occurredAt: "2026-08-23T10:00:00.000Z"
});

const accepted = (webhookEventId: string): IngestionResult => ({
  result: "accepted",
  webhookEventId,
  trustedWorkspaceId: WORKSPACE
});

const outboxRow = (webhookEventId: string): FakeRow => ({
  id: `row-${webhookEventId}`,
  workspace_id: WORKSPACE,
  webhook_event_id: webhookEventId,
  emitted_at: null,
  attempts: 0
});

function harness(rows: FakeRow[]) {
  const fake = createFakeSupabase({ tables: { provider_event_outbox: rows } });
  const sentEvents: MetaWebhookEvent[] = [];
  return { fake, sentEvents };
}

describe("dispatching accepted events", () => {
  it("sends one event per accepted result and marks it emitted", async () => {
    const { fake, sentEvents } = harness([outboxRow("evt-1")]);
    const outcome = await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1")],
      [accepted("evt-1")],
      async (e) => void sentEvents.push(e)
    );

    expect(outcome).toEqual({ sent: 1, deferred: 0 });
    expect(sentEvents).toHaveLength(1);
    expect(fake.database.rows("provider_event_outbox")[0]!.emitted_at).not.toBeNull();
  });

  it("uses the webhook event id as the send id, so the relay cannot duplicate it", async () => {
    // Both paths key on this. If they ever diverged, an event sent directly and
    // then re-sent by the relay would run the turn twice.
    const { fake, sentEvents } = harness([outboxRow("evt-1")]);
    await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1")],
      [accepted("evt-1")],
      async (e) => void sentEvents.push(e)
    );
    expect(sentEvents[0]!.id).toBe("evt-1");
    expect(sentEvents[0]!.data.webhookEventId).toBe("evt-1");
  });

  it("carries the same payload shape the relay would have sent", async () => {
    const { fake, sentEvents } = harness([outboxRow("evt-1")]);
    await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1")],
      [accepted("evt-1")],
      async (e) => void sentEvents.push(e)
    );
    expect(sentEvents[0]!.data).toEqual({
      webhookEventId: "evt-1",
      trustedWorkspaceId: WORKSPACE,
      channel: "whatsapp",
      providerEventId: "wamid.1"
    });
  });
});

describe("results that carry no new message", () => {
  it.each(["duplicate", "unknown_connection", "disabled", "policy_blocked"] as const)(
    "sends nothing for %s",
    async (result) => {
      const { fake, sentEvents } = harness([]);
      const outcome = await dispatchAcceptedEvents(
        fake.client,
        [event("wamid.1")],
        [{ result }],
        async (e) => void sentEvents.push(e)
      );
      expect(outcome).toEqual({ sent: 0, deferred: 0 });
      expect(sentEvents).toHaveLength(0);
    }
  );

  it("sends only the accepted items of a mixed batch", async () => {
    const { fake, sentEvents } = harness([outboxRow("evt-2")]);
    const outcome = await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1"), event("wamid.2"), event("wamid.3")],
      [{ result: "duplicate" }, accepted("evt-2"), { result: "unknown_connection" }],
      async (e) => void sentEvents.push(e)
    );

    expect(outcome).toEqual({ sent: 1, deferred: 0 });
    // Indexes must line up: sending event 2's payload for result 2 is the whole
    // point of walking the two arrays together.
    expect(sentEvents[0]!.data.providerEventId).toBe("wamid.2");
  });
});

describe("when the send fails", () => {
  it("leaves the row unemitted so the relay collects it", async () => {
    const { fake } = harness([outboxRow("evt-1")]);
    const outcome = await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1")],
      [accepted("evt-1")],
      async () => {
        throw new Error("inngest unreachable");
      }
    );

    expect(outcome).toEqual({ sent: 0, deferred: 1 });
    // The durability guarantee: unsent and unmarked, exactly as the relay
    // expects to find it.
    expect(fake.database.rows("provider_event_outbox")[0]!.emitted_at).toBeNull();
  });

  it("does not abandon the rest of the batch", async () => {
    const { fake, sentEvents } = harness([outboxRow("evt-1"), outboxRow("evt-2")]);
    let calls = 0;
    const outcome = await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1"), event("wamid.2")],
      [accepted("evt-1"), accepted("evt-2")],
      async (e) => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        sentEvents.push(e);
      }
    );

    expect(outcome).toEqual({ sent: 1, deferred: 1 });
    expect(sentEvents[0]!.id).toBe("evt-2");
  });

  it("defers rather than sending when the routing identifiers are absent", async () => {
    const { fake, sentEvents } = harness([]);
    const outcome = await dispatchAcceptedEvents(
      fake.client,
      [event("wamid.1")],
      [{ result: "accepted" }],
      async (e) => void sentEvents.push(e)
    );
    expect(outcome).toEqual({ sent: 0, deferred: 1 });
    expect(sentEvents).toHaveLength(0);
  });
});
