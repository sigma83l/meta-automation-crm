# Billing and Usage UI ↔ Backend Contract

**Source pages:** 19–20, 24, 27

## `/settings/billing`

Backend truth:
- subscription projection;
- entitlement projection;
- provider portal/session link generated server-side;
- renewal / paid-through / scheduled change;
- past-due/grace/canceled state.

Owner-only access.

## `/usage`

Backend truth:
- MAC;
- successful AI replies;
- automation actions;
- media;
- seats;
- thresholds/cap states.

No P&L in this surface.

## Mutations

- checkout parameters generated server-side;
- portal/session link server-generated if provider supports it;
- no client entitlement mutation;
- no plan activation from success page;
- audit role/billing changes.
