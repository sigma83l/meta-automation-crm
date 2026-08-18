# Meta Integration

The application implements production-shaped OAuth/Embedded Signup callbacks,
one-time signed state, encrypted token envelopes, asset relationship checks,
GET verification, raw-body App Secret signatures, stored account-to-workspace
routing, deduplication, fast ACK and durable outbox processing.

Opaque WhatsApp media IDs are resolved server-side. Downloads permit only fixed
Graph endpoints followed by approved HTTPS Meta CDN hosts, bounded response
sizes and allowlisted MIME types. Provider URLs are never stored as permanent
media.

WhatsApp template inventory sync normalizes ID, name, language and review
status. No template or free-form outbound adapter is enabled. App Review,
Advanced Access, WABA/phone, Instagram Professional assets and a separate
allowlisted pilot approval remain Prompt 11 requirements.

## The WhatsApp connect flow spans two browser channels

Instagram is a plain OAuth redirect. WhatsApp is not, and the difference is not
cosmetic: Meta exposes WhatsApp Business onboarding only through their JS SDK,
so the browser is a participant in the flow rather than a bystander that gets
redirected.

Two separate pieces of information come back, through two different channels,
and neither one is sufficient alone:

| What                         | Channel                       | Where it goes                             |
| ---------------------------- | ----------------------------- | ----------------------------------------- |
| Authorization code           | `FB.login` callback           | Exchanged for a token with the app secret |
| Chosen WABA and phone number | `postMessage` from the dialog | Verified against Graph, then stored       |

`launchEmbeddedSignup` settles only once it holds both. The message is accepted
from `www.facebook.com` and `web.facebook.com` and no other origin — a `message`
listener hears from anyone holding a handle to the window, so this check is what
stops a foreign page naming the portfolio stored against a workspace.

The assets travel to `/api/connections/meta/callback` as `waba_id` and
`phone_number_id`. Passing them from the browser is not trusting them:
`verifyWhatsappAccount` asks Graph for the WABA's phone numbers and refuses a
pair it cannot find there. The reason they come from the browser at all is that
the server cannot infer them — a token may see several portfolios, and which one
the user selected in the dialog is knowledge that exists only in the dialog.

Failures are named rather than generic, because each has a different remedy:
`META_WHATSAPP_PHONE_REQUIRED` (a portfolio with no number on it — the user must
add one at Meta), `META_WHATSAPP_ASSET_MISSING` (a code arrived without its
message), `META_SIGNUP_ERROR`, `META_CANCELLED`, `META_DIALOG_TIMEOUT` and
`META_SDK_BLOCKED`.
