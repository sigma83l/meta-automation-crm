# SLOs and Alerts

These are initial operational objectives for the approved commercial staging
and production environments. They are not measured production promises yet.

| Signal                      | Objective                           | Alert                                                |
| --------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Panel availability          | 99.9% monthly                       | 5-minute burn >10× or 30-minute burn >4×             |
| Health endpoint             | p95 <500 ms                         | p95 >1 s for 10 minutes                              |
| Verified webhook ACK        | p95 <1 s, p99 <2 s                  | p95 >1 s or error rate >1% for 5 minutes             |
| Durable processing          | 99% starts within 60 s              | oldest outbox >2 minutes                             |
| Duplicate outbound attempts | zero                                | any duplicate idempotency acceptance                 |
| Cross-tenant authorization  | zero incidents                      | any RLS/IDOR isolation assertion failure             |
| Dead letters                | <0.1% daily                         | >10 in 15 minutes or any permanent auth/policy error |
| Export cleanup              | expired objects removed within 24 h | oldest expired object >30 h                          |

Alerts must contain stable IDs, workspace pseudonymous IDs, route/function,
safe error code, count and timestamp. They must not contain message bodies,
tokens, credentials, customer contact data, files, raw webhook bodies or AI
prompts.

Pages: tenant-boundary failure, suspected credential exposure, duplicate send,
database outage, webhook signature bypass. Tickets: moderate latency, expected
provider throttling, individual export failure.
