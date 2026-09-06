# Meta Connectors — Instagram + WhatsApp

**Source page:** 11

## Pipeline

`Webhook → Verify + Persist → Fast ACK → Queue → Normalize → RCOS`

## Connection state machine

`disconnected / connecting / connected / degraded / reauth_required / policy_blocked / suspended`

Do not model provider state as a boolean.

## Required behavior

- Verify provider signature before processing.
- Store safe event hash + provider event ID.
- Enforce uniqueness on provider event/message IDs.
- Persist inbound durably before heavy work; return ACK quickly.
- Maintain per-conversation sequencing across retries.
- Media: metadata first, server-side fetch, MIME/size validation, private storage, signed delivery.
- Before every send, evaluate consent/window/provider state/trial/entitlement/handoff ownership.
- Delivery/read/failure events update projection; original immutable event remains unchanged.
- Reconnect/reauth uses guided recovery UI and preserves history.
- Explicit sandbox/live mode; Preview never live-sends unless owner-approved allowlist.

## V1 focus

Do not broaden to generic omnichannel. Finish WhatsApp + Instagram lifecycle, delivery, errors, reconnect, and policy first.
