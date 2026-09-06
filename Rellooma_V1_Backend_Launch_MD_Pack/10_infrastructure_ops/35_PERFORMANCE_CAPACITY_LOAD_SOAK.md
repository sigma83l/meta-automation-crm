# Performance, Capacity, Load, and Soak Acceptance

**Source page:** 32

## V1 targets

- Webhook ACK p95: **< 500 ms** after verification + durable persist path.
- Authenticated primary read p95: **< 1.5 s** under expected load.
- Mutation/write p95: **< 2.5 s** excluding async provider completion.
- HTTP error rate: **< 1%** excluding intentional 4xx.
- Queue recovery: backlog returns to normal within **~10 min** after transient outage.
- UI LCP: **≤ 2.5 s** where measurable.
- UI INP: **≤ 200 ms**.
- UI CLS: **≤ 0.1**.
- Capacity headroom: **~30%** at acceptance target.

## Load profile

- Panel ramp: `50 → 100 → 250 → 500 → 1000` virtual sessions on production-shaped staging.
- Synthetic conversation pipeline sustained load + burst.
- Never load-test real customer production or real Meta provider.
- Noisy-neighbor test: one workspace cannot starve others.
- 2-hour soak: memory/connection leaks, queue drift, DB pool saturation.
- Provider failure simulation: 429/5xx/timeouts + retry/fallback + no duplicate send.
