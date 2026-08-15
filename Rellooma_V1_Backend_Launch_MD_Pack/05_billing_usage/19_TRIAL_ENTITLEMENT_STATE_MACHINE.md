# V1 Trial and Entitlement State Machine

**Source pages:** 19–20

## V1 Trial limits

- Duration: **7 days**.
- No card; no auto-charge.
- 1 workspace / 2 seats.
- 100 MAC total.
- 150 successful customer-facing AI replies.
- 300 executed automation actions.
- 100 MB media.
- 1 live Meta connection only after gates + sandbox/testing.
- Broadcast/API/Bulk disabled.

## Trial lifecycle

1. Signup → email verification → sandbox available.
2. Live Meta only after security/onboarding gates.
3. If AI quota reaches 150 early: AI auto-reply + AI-triggered automation pause; manual/human continues until trial end.
4. Day 7: AI/automation outbound pauses immediately; no auto-charge.
5. Up to 72h inbound ingestion transition window.
6. Then integration suspends.
7. Read-only/export available up to 14 days after trial end.
8. If no subscription, deletion lifecycle schedules cleanup by Day 30 unless explicit retention policy applies.
9. Upgrade at any time must preserve workspace/context.

## Cap behavior

Caps must be server-side. UI only reflects server state.
