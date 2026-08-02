# Known Limitations

## Prompt 10 external limits

- The exact GitHub target is authorized but is created only after the final
  local review.
- The only verified Vercel team is on Hobby; commercial hosting and deployment
  are plan-blocked.
- Hosted Supabase and Inngest access is not authenticated.
- SMTP verification delivery, Turnstile domains, monitoring and paid AI
  projects require owner values.
- Meta App Review, Advanced Access and real assets remain external.
- Live outbound messaging remains intentionally absent and disabled.

## External production gates

- No client-owned hosted Supabase project/region/plan, backup policy or SMTP
  delivery has been approved and verified.
- Local tests use deterministic CAPTCHA. Production requires Turnstile and the
  implemented atomic database-backed HMAC rate limiter.
- Meta Business Portfolio/App, verification, App Review, Advanced Access,
  Embedded Signup, WABA/phone and Instagram Professional assets are unavailable.
- Live Meta code exchange and asset-verification code is implemented but cannot
  be verified without approved assets. Provider media retrieval and outbound
  sending remain disabled. Status: `LIVE_MULTI_BUSINESS_BLOCKED_BY_META`.
- Paid platform AI/BYOK external connections have not spent credit or been
  verified against client-owned accounts. Free Gemini remains synthetic-only.
- Outbox relay, verified-event processing and expired export/auth-limit cleanup
  handlers are registered locally; hosted execution still requires an approved
  Inngest environment.
- GitHub/Vercel production resources, domain/DNS, privacy policy, terms,
  deletion/retention policy, billing, MFA and deployment approval remain MANI
  actions.

## Deliberate candidate boundaries

- Structured FAQ/pricing knowledge only; no large-document RAG.
- Export work is synchronous within strict caps; cleanup is durable once hosted.
  A separate background large-export builder remains future capacity work.
- The 20-workspace test is a modest synthetic profile, not an enterprise load
  claim.
- The tracked 1,000-user k6 profiles have not run because commercially eligible
  staging is unavailable. They are not release evidence yet.
- Live Meta exchange/media retrieval remains an external/provider pilot gate;
  missing assets/configuration fail explicitly.
- No real customer data, provider credential or live send was used.

These limitations do not leave a hidden software bypass: unavailable production
capabilities fail closed or remain explicitly DEMO/PARTIAL/BLOCKED.
