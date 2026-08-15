# Runbook — Unsafe-Send Emergency Pause

**Source pages:** 18, 34, 41

1. Activate global or workspace send pause.
2. Keep inbound persistence and manual investigation available where safe.
3. Capture trace IDs, run IDs, policy state, model/route, provider result.
4. Stop retries of uncertain sends.
5. Identify whether failure is policy, entitlement, consent, provider, duplicate, or AI validation.
6. Patch with regression fixture.
7. Re-run golden tests + send-eligibility tests.
8. Resume gradually via allowlist.
