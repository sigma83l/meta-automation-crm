# End-to-End Data Flow

**Source pages:** 4, 11–23, 46

## Customer conversation path

`Meta webhook → verify → durable persist → fast ACK → queue → normalize → identity resolution → hydrate CRM state → policy gate → structured understanding → trusted retrieval → next-best-action → allowed tool/action → compose → validate → send once → commit events/projections → observe outcome/cost/latency`

## Website-to-app path

`Public page/CTA → validated attribution context → auth/access → workspace provision → onboarding → connection → first meaningful conversation → first useful AI reply → qualified lead / verified outcome → retained workspace`

## Billing path

`Checkout → Paddle → verified webhook → durable billing event → async projector/reconciliation → subscription projection → entitlement → UI`

## Support/email path

`Site/App action → validate + authorize → durable DB event/ticket → Inngest → Resend → delivery webhook → DB`

## Launch invariant

A green frontend build or preview is not launch. The same real state must be consistent across UI, backend, DB projection, provider status, and audit evidence.
