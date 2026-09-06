# Website → App Attribution Handoff

**Source pages:** 21–22, 45

## Persisted context

- locale;
- safe return path;
- first-touch source/medium/campaign;
- last-touch source/medium/campaign;
- assisted content asset;
- partner/referral ID;
- demo/pilot intent when present.

## Rules

- Store context server-side or sign it against tampering.
- Do not use marketing parameters to authorize a workspace, role, feature, trial, or plan.
- Attribution must survive auth and workspace provisioning.
- Once an outcome is verified, the same attribution chain must be linkable to it.
- External analytics may visualize; first-party event/outcome ledger remains canonical.

## Acceptance

Checklist item 83 passes only when a known source can be traced:

`site touchpoint → auth/app handoff → workspace → qualified/verified outcome`
