# Owner Access Packet

Date: 2026-07-29  
Status: **BLOCKED_OWNER_ACCESS_PACKET**

All independent local implementation and QA work is complete. The following
owner decisions/access must be resolved together before hosted work resumes.
Do not paste secret values into chat or this repository.

## 1. GitHub owner

Approve one exact private repository target:

- recommended: `Metric-One/meta-automation-crm` (the authenticated user has an
  active admin organization membership); or
- explicitly approve `metricone-mani/meta-automation-crm`.

Neither repository currently exists. Approval authorizes creation of that one
private repository, adding `origin`, pushing `main`/RC tag, enabling protected
CI and no other organization mutation.

## 2. Commercial hosting

Provide the exact commercially eligible Vercel team ID/slug and confirm its
plan. The only visible team is `metricone-8336s-projects`; commercial
eligibility is not proven and MANI stated Pro is unavailable. MANI must perform
any upgrade, billing acceptance or alternative commercial-host decision.

No Preview, production, domain or 1,000-user load test will run on Hobby or an
unverified plan.

## 3. Supabase

MANI must authenticate locally (for example with `pnpm exec supabase login`) and
provide/approve:

- exact organization and project reference;
- region and commercial plan;
- isolated staging versus production topology;
- backup/PITR and SMTP configuration;
- permission to link/apply the seven reviewed additive migrations to staging.

Do not send access tokens or service-role values in chat.

## 4. Inngest and Turnstile

Provide the approved Inngest organization/environment and configure event and
signing keys in the hosting secret store. Create the approved Turnstile site for
the exact staging/production domains and store its public/server keys in the
appropriate environments.

## 5. Meta

Provide owner-controlled evidence/identifiers (not token values):

- Business Portfolio and App;
- current reviewed Graph API version and Embedded Signup config ID;
- Business Verification, MFA, App Review and Advanced Access state;
- WABA/phone and Instagram Professional assets;
- registered callback/webhook/legal/deletion URLs;
- approved permissions, reviewer account/screencasts and template/opt-in state.

Live pilot additionally requires a separate explicit approval, a synthetic or
authorized allowlisted recipient, and confirmation that live-send gates may be
enabled only for that pilot.

## 6. Domain, legal and paid providers

Approve the exact domain/DNS owner and publish Privacy Policy, Terms, data
deletion and retention URLs. Configure production SMTP. Approve the paid
platform AI provider/billing or workspace BYOK policy. MANI must accept all
terms and payments directly.

## 7. Change approvals

After staging passes hosted security, backup/restore and both 1,000-user
profiles, provide separate explicit approvals for:

1. production code deployment with the exact immutable SHA;
2. live Meta pilot;
3. public live activation/DNS change.

## Safe response template

MANI can resume with names/IDs only:

```text
GitHub target:
Vercel commercial team slug/id and confirmed plan:
Supabase project ref, region, plan, staging/production decision:
Inngest environment:
Turnstile domains configured: yes/no
Meta identifiers/review status:
Approved staging mutation scope:
```

Secrets remain in local/provider secret stores.
