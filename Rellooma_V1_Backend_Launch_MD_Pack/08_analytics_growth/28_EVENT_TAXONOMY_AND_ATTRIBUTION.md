# First-Party Event Taxonomy and Attribution

**Source pages:** 21–22

## Two-ledger model

1. **First-party event/usage/outcome ledger** — canonical operational truth.
2. **External analytics (e.g. PostHog/GA)** — visualization/experiment consumer only.

Generic external analytics must never receive raw customer messages, phone/email, attachments, or Meta payload PII.

## Event groups

### Acquisition
- `marketing.page_viewed`
- `cta_clicked`
- `demo.started`
- `demo.completed`
- `conversation.marketing_started`
- `pilot.requested`

### Activation
- `workspace.provisioned`
- `onboarding.stage_completed`
- `channel.connected`
- `first_meaningful_received`
- `ai.first_useful_reply`

### Revenue state / outcome
- `lead.first_qualified`
- `lifecycle.changed`
- `handoff.completed`
- `appointment.booked_verified`
- `opportunity.won`
- `opportunity.lost`

### Product
- `workspace.active_week`
- `automation.activated`
- `followup.recovered`
- `integration.degraded`

### Billing
- `trial.started`
- `trial.expired`
- `trial.capped`
- `subscription.started|updated|canceled`
- `entitlement.changed`
- `usage.threshold_crossed`

### Reliability
- `webhook.failed`
- `queue.backlog`
- `provider.retry`
- `ai.validation_failed`
- `send.failed`

### Growth
- `content_asset.assisted`
- `partner_referral.activated`
- `referral.activated`
- `experiment.exposed`
