# Dynamic Site Backend and Growth Brain

**Source page:** 22

The public site UI is assumed final. Implement only the contract/data layer.

## P0/P1 engines

| Engine | Required behavior |
|---|---|
| Product Truth Registry | claim/feature/proof status = `verified / sandbox / planned / unavailable`; public pages render only allowed truth |
| Attribution Ledger | first/last/assisted campaign/content/partner source persists into workspace/outcome |
| Audience State | out-market / problem-aware / demo-intent / pilot / activated / retained |
| Consent Gate | email/WhatsApp/DM eligibility, locale quiet hours, opt-out |
| Next-Best-Marketing-Action | rule-based V1: show proof / invite demo / wait / founder handoff / nurture |
| Page Compiler | locale × vertical × use-case × proof-state; indexable page requires substantive unique content |
| Content/Creative Registry | content_asset_id + localization + truth status + CTA + source scenario |
| Experiment Registry | hypothesis, variants, primary metric, guardrails, decision |
| Partner Referral | partner_id → pilot → activated → paid with server-side attribution |

## Website → App handoff

Preserve locale, safe return URL, UTM/source/content_asset_id/partner_id in signed or server-stored attribution context.

- UTM is never auth or entitlement authority.
- Pricing/trial/CTA values come from canonical config/claim registry, not duplicated copy constants.
- Authenticated app is NOINDEX; public site owns SEO.
- Customer Stories remain gated until permissioned verified cases exist.
