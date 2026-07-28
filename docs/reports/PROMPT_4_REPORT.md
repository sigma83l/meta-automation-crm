# Prompt 4 Test Report

## Status

PASS for production-shaped contracts and complete local Sandbox.

`LIVE_MULTI_BUSINESS_BLOCKED_BY_META`

No authenticated client-owned Meta portfolio/app, Business Verification, App
Review, Advanced Access, WABA/phone, or Instagram Professional evidence was
available. No legal, account, terms, billing, token, or live-send action was
performed.

## Scope delivered

- One workspace-owned WhatsApp and Instagram connection with lifecycle, health,
  permissions, subscription state, account metadata, reauthorization,
  disconnect, and encrypted live-token envelope support.
- Embedded Signup/Instagram OAuth start and callback/state contracts. Live token
  exchange remains fail-closed until approved Meta assets exist.
- GET challenge and raw-body POST HMAC verification.
- Stored provider-account-to-workspace routing; payload workspace IDs are
  ignored.
- Atomic active-connection check, event deduplication, minimal normalized
  persistence, and exactly one durable `meta/webhook.received` outbox row.
- Normalized attachment metadata plus a background media-download interface.
- Deterministic WhatsApp text/image/delivery/read/failure and Instagram
  DM/image/post-comment/reel-comment/private-reply fixtures, duplicate retry,
  and token-expiry behavior.
- Responsive connection UI with explicit live-blocked warning. No real outbound
  adapter or send path was added.

## Verification

- Fresh four-migration reset: pass.
- Database/RLS suite: 4 files, 65 assertions pass.
- Unit suite: 7 files, 36 tests pass.
- Live local integration: 5 files, 19 tests pass.
- Desktop/mobile fixture E2E: 18 tests pass.
- Format, ESLint, strict TypeScript, production build, client-bundle boundary,
  secret scan, diff check, and production audit gate pass.
- Production audit: two Moderate findings; no High or Critical finding.

Coverage includes valid/invalid/missing signatures, empty configuration,
challenge verification, malformed payloads, retry/duplicate behavior, forged
workspace input, unknown/disabled/reauthorization connections, tenant routing,
single outbox emission, bounded ACK module behavior, status/media
normalization, safe token errors, browser token-column denial, and no payload
logging.

## Bugs found and fixed

1. Initial GET verification could accept an empty token when configuration was
   absent; verification now requires a non-empty configured token.
2. Trusted ingestion was initially placed in a non-exposed PostgREST schema;
   moved to a public-schema, service-role-only security-definer function.
3. Sandbox connection upsert inferred incompatible channel-specific row shapes;
   normalized nullable provider metadata into one stable database contract.
4. Raw normalizer used an unsafe dynamic object type; replaced it with explicit
   unknown-to-object parsing and strict normalized output.

## Remaining external work

MANI must approve and perform the Meta actions listed in
`docs/META_SETUP_REQUIRED.md`. Production also needs the real OAuth/token
exchange adapters, deployed callback verification, subscribed assets, Inngest
outbox relay registration, provider media download adapter, and an explicitly
approved later live test. Live readiness must not be claimed before evidence.
