# 1,000-User Load Report

Date: 2026-07-29

## Prepared profiles

- `load/k6/panel.js`: ramp to 1,000 concurrent synthetic panel VUs.
- `load/k6/conversations.js`: verified WhatsApp webhook arrivals up to 250/s,
  max 1,000 VUs, with 10% duplicate retries.

Thresholds and assumptions are defined in `docs/CAPACITY_MODEL.md`.

## Execution

The 1,000-user profiles were **not run**. k6 is not installed locally, and the
only visible Vercel team has no verified commercial plan. Prompt 8R prohibits
running hosted load on Vercel Hobby/unverified plans.

The earlier 20-workspace local integration profile remains valid but is not a
substitute for this hosted proof.

- `LOAD_1000_PANEL=NOT_RUN_BLOCKED_COMMERCIAL_HOSTING`
- `LOAD_1000_CONVERSATIONS=NOT_RUN_BLOCKED_COMMERCIAL_HOSTING`
