import crypto from "k6/crypto";
import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "");
const metaSecret = __ENV.META_APP_SECRET || "";
const providerAccountId = __ENV.SYNTHETIC_PROVIDER_ACCOUNT_ID || "";
if (!baseUrl.startsWith("https://")) throw new Error("BASE_URL must be HTTPS.");
if (!metaSecret || !providerAccountId)
  throw new Error("Synthetic staging webhook inputs are required.");

export const options = {
  scenarios: {
    conversations: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: [
        { duration: "2m", target: 25 },
        { duration: "3m", target: 100 },
        { duration: "5m", target: 250 },
        { duration: "5m", target: 250 },
        { duration: "3m", target: 0 }
      ]
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    checks: ["rate>0.99"]
  }
};

export default function conversationProducer() {
  const eventId = `wamid.load.${__VU}.${__ITER}`;
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-synthetic-load",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: providerAccountId },
              messages: [
                {
                  id: eventId,
                  from: `synthetic-sender-${__VU % 1000}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "Synthetic load-test conversation" }
                }
              ]
            }
          }
        ]
      }
    ]
  });
  const digest = crypto.hmac("sha256", metaSecret, body, "hex");
  const response = http.post(`${baseUrl}/api/webhooks/meta`, body, {
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${digest}`,
      "x-load-profile": "conversations-1000-synthetic"
    },
    tags: { route: "verified-meta-webhook" }
  });
  check(response, {
    "webhook acknowledged": (result) => result.status === 200,
    "response omits payload": (result) =>
      !result.body.includes(eventId) && !result.body.includes("synthetic-sender")
  });
  if (__ITER % 10 === 0) {
    const duplicate = http.post(`${baseUrl}/api/webhooks/meta`, body, {
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${digest}`
      },
      tags: { route: "verified-meta-webhook-duplicate" }
    });
    check(duplicate, { "duplicate safely acknowledged": (result) => result.status === 200 });
  }
  sleep(0.1);
}
