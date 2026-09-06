# Environment, Config, and Secret Registry

**Source pages:** 2, 29, 31, 39–40

The PDF requires configuration to be versioned and provider secrets scoped. Exact variable names must be reconciled with the repository. This file defines the logical registry only.

## Versioned non-secret config domains

- provider project/account IDs;
- model role → model ID mappings;
- prompt/snapshot versions;
- pricing/product mapping references;
- trial limits and lifecycle timings;
- plan entitlement rules;
- provider feature flags;
- queue/concurrency limits;
- rate-limit policy;
- allowed redirect origins/paths;
- MIME/size limits;
- locale/quiet-hour policy;
- retention/deletion policy versions;
- truth/claim status registry.

## Secret domains — server-side only

- Meta tokens/system-user credentials/webhook secret;
- Paddle API/webhook credentials;
- AI provider keys;
- Supabase service-role credentials;
- Resend API/webhook credentials;
- Inngest signing keys;
- private backup credentials;
- any OAuth client secret.

## Rules

- No secret in client bundle.
- No plaintext secret in backups.
- Environment-scoped secrets.
- Rotation/recovery procedure documented.
- Owner retains ownership/billing/recovery accounts; developer gets scoped access only.
- Record secret **references/owners**, never values, in evidence pack.
