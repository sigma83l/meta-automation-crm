# AI Account and Privacy Setup

`PLATFORM_PAID_DEFAULT` uses a paid platform-owned provider key held in server
environment configuration. `WORKSPACE_BYOK_*` accepts a paid workspace key over
TLS and returns only provider, status, version, and a masked suffix.
`FREE_GEMINI_DEMO_SYNTHETIC_ONLY` accepts explicit Demo mode and synthetic
fixtures only; webhooks, CRM records, customer messages, media, and exports are
denied. Paid/BYOK errors never fall back to free Gemini.

Gemini requires a paid Google AI project, OpenAI a paid platform project, and
Anthropic a paid Console workspace. Each needs a restricted server key. MANI
must approve account creation, terms, billing, keys, and production enablement.
Local development uses the deterministic adapter and spends no provider credit.

Production must supply a 32-byte base64 `CREDENTIAL_ENCRYPTION_KEY` through the
hosting secret manager. Use different restricted keys per environment. Never
place keys in source, issues, fixtures, analytics, client environment variables,
logs, or chat.

For rotation, submit and test the replacement, then revoke the prior provider
key. A new random IV is generated and the envelope version increments. Master
key rotation is a controlled server-side re-encryption job using the prior key
version; plaintext must never leave server memory.
