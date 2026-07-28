# Prompt 3 Test Report

## Status

PASS — structured business knowledge, AI privacy and output contracts, encrypted
BYOK lifecycle, workspace isolation, settings UI, and all local gates pass.

## Scope delivered

- Workspace profile: brand, description, languages, style, emoji policy,
  business hours/timezone, forbidden claims, escalation terms, confidence, and
  retention.
- Structured FAQ and price knowledge; no document RAG.
- Explicit paid platform, Gemini/OpenAI/Anthropic BYOK, and free synthetic-Demo
  modes with no cross-mode fallback.
- Application-owned strict reply/provider contracts, bounded context, safe
  provider errors, usage metadata, prompt-injection and human-review policy.
- Server-only AES-256-GCM BYOK store, test, rotate, delete, versioning, masking,
  audit metadata, and browser ciphertext denial.
- Desktop/mobile Business Profile, Pricing, FAQs, AI Style, Provider, masked
  status, credential actions, and Demo warning.

## Verification

- Fresh three-migration reset: pass.
- Database/RLS suite: 3 files, 49 assertions pass.
- Unit suite: 6 files, 31 tests pass.
- Live local integration: 4 files, 17 tests pass.
- Full desktop/mobile E2E: 16 tests pass.
- Formatting, ESLint, strict TypeScript, production build, client-bundle secret
  boundary, secret scan, diff check, and production audit gate pass.
- Production dependency audit reports two Moderate findings and no High or
  Critical finding.

Tests cover strict schema, Turkish field extraction, missing knowledge/price,
low confidence, injection, timeout/rate-limit classification, paid/BYOK
selection, free-Gemini real-data rejection, AES-GCM round-trip and wrong-key
failure, absent plaintext, masked-column exposure, browser credential-write
denial, and cross-workspace profile/knowledge/credential denial.

## Bugs found and fixed

1. Credential metadata initially granted browser access to encrypted columns;
   replaced with column-level masked metadata grants and regression assertions.
2. Service-role credential writes were missing explicit table privileges;
   added the server-only grant while retaining forced RLS/browser denial.
3. Local Supabase restart could briefly reject new JWTs as issued in the future;
   added bounded retry coverage to the older auth test and new AI test.
4. Parallel E2E signup load exceeded local Auth emulator behavior; capped
   Playwright workers at two.
5. Settings labels were ambiguous and mobile customer actions overflowed;
   tightened selectors and responsive layout.

## External gates and limits

No real AI network call or credit was used. Production provider accounts, paid
billing, keys, hosted secrets, TLS deployment, and live connection tests require
MANI approval. Production master-key rotation needs a controlled re-encryption
job. Provider-specific HTTP adapters remain intentionally unregistered until
the approved infrastructure stage; the domain interface and deterministic
adapter are complete.
