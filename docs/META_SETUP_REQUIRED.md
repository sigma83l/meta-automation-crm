# Meta Setup Required

## Current status

`LIVE_MULTI_BUSINESS_BLOCKED_BY_META`

Sandbox connections, webhook security, routing, normalization, deduplication,
media-download contracts, and background event contracts are implemented. No
client-owned Meta assets or authenticated access were available or modified.

## Ownership and assets

MANI/client must own and control:

- a Meta Business Portfolio with MFA and Business Verification where required;
- one Meta App configured for the business product;
- approved WhatsApp and Instagram products, App Review, and Advanced Access;
- WhatsApp Embedded Signup configuration, WABA, registered phone number,
  display name, payment method where required, and two-step verification PIN;
- Instagram Professional accounts linked to the appropriate Facebook Page and
  eligible for messaging.

Codex must not create a legal identity, accept terms, bypass verification, or
invent app/account identifiers.

## App and URLs

Configure separate Preview and Production HTTPS origins. Register:

- OAuth callback:
  `https://<domain>/api/connections/meta/callback`
- webhook callback:
  `https://<domain>/api/webhooks/meta`
- privacy policy, terms, user-data deletion instructions/callback, and data
  retention pages on the client-owned domain.

The App Secret and webhook verification token are server-only. Redirect URLs
must exactly match the deployed origin. Webhook POST requests must include a
valid `X-Hub-Signature-256` over the untouched body.

## Permissions and subscriptions

WhatsApp messaging requires:

- `whatsapp_business_management`
- `whatsapp_business_messaging`

Instagram messaging requires:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Request a comment-related permission and comments webhook subscription only
when comment automation is enabled and its review evidence is ready. Subscribe
only workspace-owned provider account identifiers stored during the connection
flow.

## App Review evidence

Prepare reviewer instructions, a dedicated non-customer test account, seeded
synthetic conversations, and a screencast that shows:

- login and self-service connection;
- why each permission is needed;
- message receipt and reply flow;
- optional comment-to-private-reply flow if requested;
- disconnect, deletion, and privacy controls;
- no access to unrelated business assets.

WhatsApp production also requires approved opt-in wording, template categories
and samples, template/payment review where applicable, phone ownership, and PIN
handling. Never place PINs or credentials in this repository or review notes.

## MANI actions

MANI must perform or explicitly approve Business login, MFA, portfolio/app
creation, verification submissions, legal URLs, App Review submissions,
Advanced Access, payment, WABA/phone selection, Instagram Professional account
linking, reviewer account access, credential generation, and live-test
allowlists. Record evidence without secret values before changing the status.
