# Source of Truth and Conflict Policy

**Source page:** 3

## Authority order

1. **Current runtime / repository / tests** — actual behavior and existing contracts.
2. **Current provider contracts** — Meta, Paddle, OpenAI, Supabase, Vercel, Inngest, Resend; revalidate before Production.
3. **Approved Rellooma product architecture** — RCOS, Business Memory, Trial, Usage Meter, Growth Event model.
4. **Final UI/UX packs** — interaction and presentation contract, not permission or domain authority.
5. **This implementation pack** — synthesis; conflicts must be registered and resolved.

## Domain truth separation

| Domain | Source of Truth | UI role |
|---|---|---|
| Workspace / role | Verified session + active membership resolver | Display only |
| Conversation | Immutable messages/events + CRM memory | Render projection |
| AI decision | `agent_run` + decision schema + evidence | Explain why/next action/confidence |
| Send eligibility | Policy engine + consent + provider state | Show allowed/blocked + reason |
| Booking/payment | Authoritative tool/provider result | Show confirmed IDs/status |
| Subscription | Verified Paddle webhook + reconciliation | Show plan/status/renewal |
| Usage | Append-only usage ledger | Show aggregate counters |
| Deletion | Deletion workflow + tombstone | Show scheduled/in-progress/done |

## Conflict rule

Never silently overwrite. Every conflict must record:

- area,
- current behavior,
- specification expectation,
- evidence,
- risk,
- proposed resolution,
- owner approval if required.
