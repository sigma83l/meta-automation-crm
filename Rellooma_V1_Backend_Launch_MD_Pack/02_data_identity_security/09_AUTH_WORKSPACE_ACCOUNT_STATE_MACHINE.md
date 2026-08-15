# Auth, Workspace Provisioning, and Account State Machine

**Source page:** 10

## Canonical flow

`Signup → Verify Email → Atomic Workspace Provision → Sandbox/Trial → Activated/Paid`

## Required account states

| State | Inbound | Outbound | AI | Authority |
|---|---|---|---|---|
| `unverified` | no live provider | no | no | Supabase Auth |
| `trial_active` | yes after live connection gate | yes within policy | within quota | server trial state |
| `trial_ai_capped` | yes | manual/human only | no auto AI | usage evaluator |
| `trial_expired_grace` | up to configured 72h | read-only outbound | no | trial lifecycle job |
| `paid_active` | yes | yes | by entitlement | verified Paddle event |
| `past_due/grace` | preserve data | configurable restricted outbound | policy | billing policy |
| `canceled_paid_through` | yes until paid-through | normal until period end | entitlement | subscription period |
| `suspended` | policy-dependent | read-only/recovery | no | server policy |
| `deletion_pending` | provider automation disabled | no | no | explicit deletion workflow |

## Auth rules

- Email verification before live connection.
- Password recovery is Auth-only; AI/support never handles reset tokens.
- Workspace + owner membership + onboarding + default settings provision atomically and idempotently.
- Cancel subscription is never equivalent to Delete Workspace.
- Strict redirect allowlist, Turnstile/rate limits, secure session handling.
