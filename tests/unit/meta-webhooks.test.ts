import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeMetaWebhook } from "@/src/modules/integrations/meta/normalizer";
import { acceptsInbound, permitsOutbound } from "@/src/modules/integrations/meta/contracts";
import {
  createSandboxMetaConnectionAdapter,
  sandboxMetaFixtures
} from "@/src/modules/integrations/meta/sandbox-adapter";
import {
  ingestVerifiedMetaPayload,
  type MetaWebhookRepository
} from "@/src/modules/integrations/meta/webhook-ingestion";
import {
  verifyMetaChallenge,
  verifyMetaSignature
} from "@/src/modules/integrations/meta/webhook-security";
const whatsAppPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-synthetic",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "wa-phone-sandbox" },
            messages: [
              {
                id: "wamid.synthetic.001",
                from: "synthetic-sender",
                timestamp: "1767225600",
                type: "image",
                image: { id: "media-synthetic", mime_type: "image/png", filename: "fixture.png" }
              }
            ]
          }
        }
      ]
    }
  ]
};
const instagramPayload = {
  object: "instagram",
  entry: [
    {
      id: "ig-account-sandbox",
      messaging: [
        {
          sender: { id: "synthetic-sender" },
          recipient: { id: "ig-account-sandbox" },
          message: { mid: "ig-mid-001", text: "Synthetic DM" }
        }
      ]
    }
  ]
};
describe("Meta webhook security and sandbox contracts", () => {
  it("verifies challenge and exact raw-body signatures", () => {
    const secret = "synthetic-meta-secret-value",
      raw = new TextEncoder().encode(JSON.stringify(whatsAppPayload));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=bad", secret)).toBe(false);
    expect(verifyMetaSignature(new TextEncoder().encode("changed"), signature, secret)).toBe(false);
    expect(
      verifyMetaChallenge(
        { mode: "subscribe", token: "synthetic-token", challenge: "123" },
        "synthetic-token"
      )
    ).toBe("123");
    expect(
      verifyMetaChallenge(
        { mode: "subscribe", token: "wrong", challenge: "123" },
        "synthetic-token"
      )
    ).toBeNull();
    expect(verifyMetaChallenge({ mode: "subscribe", token: "", challenge: "123" }, "")).toBeNull();
  });
  it("normalizes WhatsApp image and Instagram DM without trusting workspace input", () => {
    const forged = { ...whatsAppPayload, workspace_id: "forged-workspace" };
    const wa = normalizeMetaWebhook(forged),
      ig = normalizeMetaWebhook(instagramPayload);
    // A delivery normalizes to a list now; these fixtures each carry one event.
    expect(wa.ok && wa.value[0]).toMatchObject({
      channel: "whatsapp",
      providerAccountId: "wa-phone-sandbox",
      providerEventId: "wamid.synthetic.001",
      senderRef: "synthetic-sender"
    });
    expect(wa.ok && wa.value[0]?.attachments[0]).toMatchObject({
      providerMediaId: "media-synthetic",
      downloadState: "pending"
    });
    expect(ig.ok && ig.value[0]).toMatchObject({
      channel: "instagram",
      providerAccountId: "ig-account-sandbox",
      providerEventId: "ig-mid-001",
      text: "Synthetic DM"
    });
    expect(JSON.stringify(wa)).not.toContain("forged-workspace");
  });
  it("never promotes an untrusted provider URL to a media download target", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig-account-sandbox",
          messaging: [
            {
              sender: { id: "synthetic-sender" },
              message: {
                mid: "ig-mid-ssrf",
                attachments: [
                  {
                    type: "image",
                    payload: { url: "http://127.0.0.1:54321/internal-metadata" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok && result.value[0]?.attachments[0]?.providerMediaId).toBe("unresolved");
    expect(JSON.stringify(result)).not.toContain("127.0.0.1");
  });
  it("ACKs valid events quickly and emits once across webhook retries", async () => {
    const seen = new Set<string>();
    const repository: MetaWebhookRepository = {
      async ingest(event) {
        if (seen.has(event.providerEventId)) return { result: "duplicate" };
        seen.add(event.providerEventId);
        return {
          result: "accepted",
          webhookEventId: "event-1",
          trustedWorkspaceId: "trusted-workspace"
        };
      }
    };
    const started = performance.now();
    const first = await ingestVerifiedMetaPayload(whatsAppPayload, repository),
      retry = await ingestVerifiedMetaPayload(whatsAppPayload, repository);
    expect(performance.now() - started).toBeLessThan(100);
    expect(first).toMatchObject({
      acknowledged: true,
      status: "accepted",
      trustedWorkspaceId: "trusted-workspace"
    });
    expect(retry).toMatchObject({ acknowledged: true, status: "duplicate" });
    expect(seen.size).toBe(1);
  });
  it("covers all deterministic provider fixtures and safe token expiry", async () => {
    expect(Object.keys(sandboxMetaFixtures)).toEqual([
      "whatsappText",
      "whatsappImage",
      "whatsappDelivered",
      "whatsappRead",
      "whatsappFailed",
      "instagramDm",
      "instagramImage",
      "instagramComment",
      "instagramReelComment",
      "instagramPrivateReply"
    ]);
    const active = createSandboxMetaConnectionAdapter("whatsapp"),
      expired = createSandboxMetaConnectionAdapter("instagram", { expired: true });
    expect((await active.testConnection()).ok).toBe(true);
    const failure = await expired.testConnection();
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error.message).not.toMatch(/token|secret|key/i);
  });
  it("does not log message or media payloads on rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ingestVerifiedMetaPayload(
      { bad: "private-message-secret" },
      {
        async ingest() {
          throw new Error("must not run");
        }
      }
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("batched deliveries", () => {
  // The defect: normalization read entry[0].changes[0] and one message inside
  // it, so everything after the first item was discarded silently. Meta batches
  // routinely under load, which is exactly when losing messages matters most.

  it("returns every message in a multi-entry, multi-message delivery", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-a",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-a" },
                messages: [
                  { id: "wamid.1", from: "cust-1", timestamp: "1786000001", text: { body: "one" } },
                  { id: "wamid.2", from: "cust-2", timestamp: "1786000002", text: { body: "two" } }
                ]
              }
            }
          ]
        },
        {
          id: "entry-b",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-b" },
                messages: [
                  {
                    id: "wamid.3",
                    from: "cust-3",
                    timestamp: "1786000003",
                    text: { body: "three" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value.map((event) => event.providerEventId)).toEqual([
      "wamid.1",
      "wamid.2",
      "wamid.3"
    ]);
    // Routing identity must follow the entry each message arrived in, not the
    // first one in the payload.
    expect(result.value.map((event) => event.providerAccountId)).toEqual([
      "wa-phone-a",
      "wa-phone-a",
      "wa-phone-b"
    ]);
    expect(result.value.map((event) => event.text)).toEqual(["one", "two", "three"]);
  });

  it("preserves arrival order so per-conversation sequencing survives", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-a",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-a" },
                messages: Array.from({ length: 5 }, (_unused, index) => ({
                  id: `wamid.seq.${index}`,
                  from: "cust-1",
                  timestamp: `${1786000000 + index}`,
                  text: { body: `m${index}` }
                }))
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok && result.value.map((event) => event.providerEventId)).toEqual([
      "wamid.seq.0",
      "wamid.seq.1",
      "wamid.seq.2",
      "wamid.seq.3",
      "wamid.seq.4"
    ]);
  });

  it("returns statuses alongside messages rather than choosing one kind", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-a",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-a" },
                messages: [
                  { id: "wamid.10", from: "cust", timestamp: "1786000010", text: { body: "hi" } }
                ],
                statuses: [{ id: "wamid.09", status: "delivered", timestamp: "1786000009" }]
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((event) => event.type)).toEqual(["message", "message_status"]);
    expect(result.value[1]?.status).toBe("delivered");
  });

  it("drops only the unroutable item, never the rest of the batch", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-a",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-a" },
                messages: [
                  { from: "cust", timestamp: "1786000001", text: { body: "no id" } },
                  { id: "wamid.good", from: "cust", timestamp: "1786000002", text: { body: "ok" } }
                ]
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok && result.value.map((event) => event.providerEventId)).toEqual(["wamid.good"]);
  });

  it("collapses an item repeated inside one delivery", () => {
    // A provider that repeats an id within a single POST must not produce two
    // rows; the database constraint is the second line of defence, not the first.
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-a",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "wa-phone-a" },
                messages: [
                  { id: "wamid.dup", from: "cust", timestamp: "1786000001", text: { body: "a" } },
                  { id: "wamid.dup", from: "cust", timestamp: "1786000001", text: { body: "a" } }
                ]
              }
            }
          ]
        }
      ]
    };
    const result = normalizeMetaWebhook(payload);
    expect(result.ok && result.value).toHaveLength(1);
  });

  it("still rejects a payload carrying no usable event", () => {
    const result = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [] });
    expect(result.ok).toBe(false);
  });
});

describe("batched ingestion", () => {
  const batched = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-a",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "wa-phone-a" },
              messages: [
                { id: "wamid.b1", from: "c1", timestamp: "1786000001", text: { body: "one" } },
                { id: "wamid.b2", from: "c2", timestamp: "1786000002", text: { body: "two" } },
                { id: "wamid.b3", from: "c3", timestamp: "1786000003", text: { body: "three" } }
              ]
            }
          }
        ]
      }
    ]
  };

  function recordingRepository() {
    const persisted: string[] = [];
    const repository: MetaWebhookRepository = {
      async ingest(event) {
        if (persisted.includes(event.providerEventId)) return { result: "duplicate" };
        persisted.push(event.providerEventId);
        return {
          result: "accepted",
          webhookEventId: `evt-${event.providerEventId}`,
          trustedWorkspaceId: "trusted-workspace"
        };
      }
    };
    return { repository, persisted };
  }

  it("persists every event in the delivery, not only the first", async () => {
    const { repository, persisted } = recordingRepository();
    const result = await ingestVerifiedMetaPayload(batched, repository);
    expect(persisted).toEqual(["wamid.b1", "wamid.b2", "wamid.b3"]);
    expect(result).toMatchObject({ acknowledged: true, eventCount: 3, acceptedCount: 3 });
  });

  it("stays idempotent when the provider retries the whole delivery", async () => {
    const { repository, persisted } = recordingRepository();
    await ingestVerifiedMetaPayload(batched, repository);
    const retry = await ingestVerifiedMetaPayload(batched, repository);
    expect(persisted).toHaveLength(3);
    expect(retry).toMatchObject({ acknowledged: true, acceptedCount: 0, eventCount: 3 });
  });

  it("persists the remaining events when one is rejected", async () => {
    // One unroutable event must not discard the batch around it.
    const persisted: string[] = [];
    const repository: MetaWebhookRepository = {
      async ingest(event) {
        if (event.providerEventId === "wamid.b2") return { result: "unknown_connection" };
        persisted.push(event.providerEventId);
        return { result: "accepted", trustedWorkspaceId: "trusted-workspace" };
      }
    };
    const result = await ingestVerifiedMetaPayload(batched, repository);
    expect(persisted).toEqual(["wamid.b1", "wamid.b3"]);
    expect(result).toMatchObject({ acknowledged: true, acceptedCount: 2, eventCount: 3 });
  });
});

describe("connection state predicates", () => {
  it("accepts inbound only where the connection is live", () => {
    expect(acceptsInbound("active")).toBe(true);
    // Impaired, not absent: refusing would lose the customer's words rather
    // than surface our problem.
    expect(acceptsInbound("degraded")).toBe(true);
    for (const status of [
      "pending",
      "policy_blocked",
      "disabled",
      "reauth_required",
      "disconnected"
    ] as const) {
      expect(`${status}:${acceptsInbound(status)}`).toBe(`${status}:false`);
    }
  });

  it("permits outbound on a narrower set than inbound", () => {
    // A degraded connection may still record what arrives, but is not a safe
    // send target; a policy-blocked one must never be sent to at all.
    expect(permitsOutbound("active")).toBe(true);
    expect(permitsOutbound("degraded")).toBe(false);
    expect(permitsOutbound("policy_blocked")).toBe(false);
  });

  it("never permits outbound where inbound is refused", () => {
    for (const status of [
      "pending",
      "active",
      "degraded",
      "policy_blocked",
      "disabled",
      "reauth_required",
      "disconnected"
    ] as const) {
      if (permitsOutbound(status))
        expect(`${status}:${acceptsInbound(status)}`).toBe(`${status}:true`);
    }
  });
});
