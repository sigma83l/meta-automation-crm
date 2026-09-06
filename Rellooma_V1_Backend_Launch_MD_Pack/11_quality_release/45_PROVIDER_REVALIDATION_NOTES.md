# Provider Revalidation Notes

**Source pages:** 40, 47

These are the source specification's provider checks as of **15 Aug 2026**. They are not a substitute for a fresh pre-cutover review. Record the exact docs/version/date in the evidence pack.

## Paddle
- Verify webhook signature against the raw body using `Paddle-Signature` and endpoint secret.
- Base subscription fulfillment on verified events plus lifecycle/reconciliation.
- Re-check webhook/event/subscription behavior before Production.

## OpenAI / AI provider
- Use supported tool/function calling and structured JSON-schema outputs.
- Measure cache-related metadata such as cached tokens/prompt caching when available.
- Review storage/data-retention settings against Rellooma privacy posture.
- Keep model IDs and provider behavior versioned/configurable.

## Supabase
- RLS is mandatory on exposed schemas.
- Storage access also uses RLS.
- Database backup does **not** by itself back up Storage objects; Storage requires a separate backup path.

## Inngest
- Use concurrency keys for multi-tenant fairness.
- Apply throttling for provider rate limits.
- Use durable execution for retries/idempotency.
- Application side effects must remain idempotent even if the queue platform provides retry/idempotency features.

## Vercel
- Use Preview protection and environment-scoped secrets.
- Production and Preview variables/deployments are distinct.
- Secret changes apply to new deployments; confirm the exact candidate deployment has the intended configuration.

## Cutover rule
Re-check current official provider docs immediately before Production cutover and record reviewed versions/dates.
