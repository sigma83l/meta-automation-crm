# CRM Revenue State, Qualification, Follow-up, and Handoff

**Source page:** 17

## Keep three concepts separate

### Lifecycle
`New → Engaged → Qualified → Sales-ready → Opportunity → Customer → Retention`

### Lead status
`Awaiting Customer / Follow-up / Booked / Payment Pending / Lost`

### Qualification score
Evidence-based fit/readiness with `reason + confidence + evidence`.

## Qualification policy

- First contact: intent + one necessary constraint.
- Consideration: fit + desired outcome + timing.
- Ready: transaction-required slots only.
- High-value: budget/decision process only if it changes the outcome.
- Never ask a question merely because the CRM has a field.

## Follow-up engine

Timer-only sequences are prohibited. Every follow-up stores:

`stop_reason + objective + eligibility + message_version + cancel_condition`

| Stop reason | Next action | Stop condition |
|---|---|---|
| waiting_after_answer | contextual check + optional next step | bounded no-response cadence |
| price_sent | diagnose affordability vs value | explicit no / no consent |
| appointment_proposed | specific available slots/reminder | booked/cancelled |
| human_promised_response | ownership update / ETA if known | human completes |
| abandoned_booking | resume last completed step | booked/stop |
| post_service | relevant retention check | opt-out/complete |

## Handoff packet

- one-line summary;
- intent + mental state;
- known facts;
- score + reasons;
- objections;
- actions already taken;
- suggested next action;
- policy flags;
- owner + SLA.
