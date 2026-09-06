# Moving the database to eu-central-1

**Decision:** 2026-08-17, owner. Production Postgres moves from `ap-south-1`
(Mumbai) to `eu-central-1` (Frankfurt).

**Why:** the business and its customers are in Türkiye. With the database in
India, every stored customer message is a cross-border transfer of personal data
under KVKK Art. 9, which needs explicit consent or an undertaking. Frankfurt
removes that for EU data and puts KVKK on far simpler footing. Doing it now
costs an afternoon; doing it after the first paying customer costs a maintenance
window and a data migration.

## Why this is low risk right now

This is **not** a data migration. Row counts on the live project, taken
2026-08-17:

| Table                   | Rows                                                    |
| ----------------------- | ------------------------------------------------------- |
| `customers`             | **0**                                                   |
| `conversations`         | **0**                                                   |
| `messages`              | **0**                                                   |
| `automation_runs`       | **0**                                                   |
| `outbound_attempts`     | **0**                                                   |
| `workspaces`            | 4 — all test (`Test 1`, `Delivery Test`, `had`, `Mani`) |
| `profiles`              | 4                                                       |
| `workspace_memberships` | 4                                                       |
| `business_profiles`     | 4                                                       |
| `meta_connections`      | 4 — sandbox                                             |
| `onboarding_states`     | 4                                                       |
| `automations`           | 1                                                       |

There is no customer data to lose. So the procedure is provision-fresh and
repoint, with no dump, no restore, and no cutover window that matters — not the
delicate operation "database migration" normally implies.

## What it also fixes

`node scripts/verify-remote-schema.mjs` against the Mumbai project reports
**49 of 78 relations present, 29 missing** — the nine billing tables plus
everything added in P5–P10 were never applied there. This is C-012 in the
conflict register, resurfacing because migrations have only ever been applied
locally.

The new project gets every migration applied from empty, so it starts correct.
That is arguably a bigger win than the region change.

## Procedure

Steps marked **[you]** create billable resources, handle secrets, or change
production. Steps marked **[me]** I can run and verify.

### 1. Create the project — [you]

<https://supabase.com/dashboard/new> — organisation `jsbiaiqyiajjxnmslgow`
(the one holding the current `crm` project).

- **Name:** `crm-eu`
- **Region:** `Central EU (Frankfurt)` / `eu-central-1`
- **Database password:** generate a strong one and put it straight in your
  password manager. Do not paste it into chat. You will need it once, in step 2.

Wait for the project to reach _Active_.

### 2. Apply every migration — [me, once you link]

```bash
npx supabase link --project-ref <new-ref>     # prompts for the DB password
npx supabase db push                          # applies all migrations in order
```

`db push` also creates the storage buckets and their policies — they are defined
in `20260728090000_auth_workspace_isolation.sql`, not configured by hand — so
nothing about storage needs recreating in the dashboard.

### 3. Verify the schema — [me]

```bash
SUPABASE_URL=https://<new-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<new service role key> \
node scripts/verify-remote-schema.mjs
```

Expect **78/78 present**. Anything less means a migration failed and the cutover
must not proceed.

This checks that relations exist and are exposed. It does not check RLS
behaviour, which needs a real JWT — that is `supabase test db` against
`supabase/tests/database`.

### 4. Replicate the auth settings — [you]

These live in the dashboard, not in migrations, so `db push` does not carry them
over. Verified on the current project:

| Setting            | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| Email provider     | Enabled — the only provider                             |
| Signups            | Enabled (`disable_signup: false`)                       |
| Confirm email      | **On** (`mailer_autoconfirm: false`) — do not skip this |
| Site URL           | `https://app.rellooma.com`                              |
| Redirect allowlist | `https://app.rellooma.com/**`                           |

Authentication → URL Configuration, and Authentication → Providers → Email.

If the Mumbai project has custom SMTP or edited email templates, copy those too;
otherwise the built-in mailer applies, which is what delivery was proven against.

### 5. Swap the environment — [you]

Three variables. `vercel env add` will not overwrite, so remove first:

```bash
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  npx vercel env rm "$v" production
  npx vercel env add "$v" production
done
```

Update `.env.local` with the same three, or local work will keep pointing at
Mumbai and the difference will present as confusing test failures.

### 6. Redeploy — [you]

```bash
npx vercel --prod
```

An environment change alone does not affect the running deployment.

### 7. Smoke test — [me]

```bash
curl -s https://app.rellooma.com/api/health | jq
```

Then, in a browser: sign up with a fresh address, confirm the email, complete
onboarding, and check the workspace resolves. That exercises auth, the trigger
that provisions a workspace, RLS, and storage in one pass.

The four existing test accounts are not migrated. Register again — that is the
smoke test.

### 8. Retire the old project — [you, after a week]

**Pause** rather than delete, from the Mumbai project's dashboard. It is the
rollback path, and it costs nothing while paused. Delete it once the new project
has run for a week without incident.

## Rollback

Until step 8 the rollback is: put the three old values back and redeploy. The
Mumbai project is untouched throughout — nothing in this procedure writes to it,
drops anything, or changes its configuration.

## After the cutover

- Fill `[TRANSFER MECHANISM]` in `app/privacy/page.tsx`. With Frankfurt and an
  EU/Türkiye user base this becomes straightforward rather than load-bearing.
- Update `[PROCESSING REGIONS]`, currently stating Mumbai, and the Supabase entry
  in `app/subprocessors/page.tsx`, which names `ap-south-1`. Both are factual
  claims on a public page and must not be left stale.
- Re-run `pnpm test` and the pgTAP suite against the new project.
