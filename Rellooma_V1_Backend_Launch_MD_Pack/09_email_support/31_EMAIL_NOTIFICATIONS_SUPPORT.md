# Email, Notifications, and Support Connectors

**Source page:** 23

## Responsibilities

| System | Responsibility |
|---|---|
| Google Workspace | human/business mail on `@rellooma.com`; owner/support/sales/billing/legal aliases |
| Resend `notify.rellooma.com` | transactional verify/recovery/security/billing/support/notifications |
| Resend `news.rellooma.com` | marketing/lifecycle only with consent + unsubscribe |
| `reply.rellooma.com` | optional inbound ticket threading via verified webhook |
| Supabase Auth | email verification/password recovery authority |
| Inngest | async send/retry/delivery orchestration |
| Rellooma DB | email events, consent, support ticket source of truth |

## Flow

`Site/App action → validate + authorize → DB event/ticket → Inngest → Resend → Delivery webhook → DB`

## Rules

- UI never blocks waiting for email provider; create durable event/ticket first.
- Support email is a notification; DB ticket is source of truth.
- Inbound reply requires token/message-ID correlation; sender email alone is not authorization.
- Default to no-reply unless ticket-specific human Reply-To is justified.
- Recovery tokens/OTP/password never enter logs, analytics, support, or AI context.
