# Known Limitations

## External production gates

- No client-owned hosted Supabase project/region/plan, backup policy or SMTP
  delivery has been approved and verified.
- Turnstile uses deterministic local mode; a shared distributed auth limiter is
  required before multi-instance deployment.
- Meta Business Portfolio/App, verification, App Review, Advanced Access,
  Embedded Signup, WABA/phone and Instagram Professional assets are unavailable.
- Real Meta OAuth token exchange, provider media retrieval and outbound sending
  remain disabled. Status: `LIVE_MULTI_BUSINESS_BLOCKED_BY_META`.
- Paid platform AI/BYOK external connections have not spent credit or been
  verified against client-owned accounts. Free Gemini remains synthetic-only.
- Hosted Inngest execution, outbox relay, scheduled export cleanup and retention
  enforcement require an approved environment.
- GitHub/Vercel production resources, domain/DNS, privacy policy, terms,
  deletion/retention policy, billing, MFA and deployment approval remain MANI
  actions.

## Deliberate candidate boundaries

- Structured FAQ/pricing knowledge only; no large-document RAG.
- Export work is synchronous within strict local caps; large-job and cleanup
  contracts exist but need hosted workers.
- The 20-workspace test is a modest synthetic profile, not an enterprise load
  claim.
- No real customer data, provider credential or live send was used.

These limitations do not leave a hidden software bypass: unavailable production
capabilities fail closed or remain explicitly DEMO/PARTIAL/BLOCKED.
