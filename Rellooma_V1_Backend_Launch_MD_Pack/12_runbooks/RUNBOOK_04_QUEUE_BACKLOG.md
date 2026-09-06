# Runbook — Queue Backlog

**Source pages:** 30–32, 41

1. Identify queue class and backlog age.
2. Protect `inbound-critical` before non-critical work.
3. Enforce per-tenant and provider-global concurrency.
4. Throttle campaign/bulk first; trial bulk remains disabled.
5. Do not violate per-conversation ordering.
6. Retry only transient failures.
7. Verify no duplicate side effects.
8. Target backlog recovery to normal within ~10 minutes after transient outage.
