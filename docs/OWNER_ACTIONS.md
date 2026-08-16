# Owner actions — how to do each one

Four external actions, none of which an agent can perform: they all involve
accounts and credentials under your control. Written in dependency order, which
is not the same as the priority order in `LAUNCH_READINESS.md`.

**The dependency that matters:** Meta App Review (#4) requires a live privacy
policy URL and data deletion URL, and it will reject pages showing
`[LEGAL ENTITY NAME]`. So the legal placeholders (#2) block the Meta pilot.
Paddle (#3) is independent and can run in parallel.

```
#1 rotate secret ──────────────────────────────► (independent, do first, ~10 min)
#2 legal values ──────────► #4 Meta App Review ► pilot
#3 Paddle account ─────────────────────────────► (parallel)
```

---

## 1. Rotate `META_APP_SECRET`

**Why this is first:** it is the only live security exposure. The secret was
pasted into a chat transcript, and it is simultaneously

- the HMAC key for verifying inbound webhook signatures (`X-Hub-Signature-256`),
- the signing key for OAuth `state` (see `connection-service.ts:103`), and
- the client secret for OAuth code exchange.

Anyone holding it can forge webhooks into your system and forge OAuth state.

**Before you start — check the blast radius:**

```bash
npx vercel env pull .env.production.local --environment production
grep META_CONNECTION_MODE .env.production.local
```

If it says `sandbox`, this rotation is zero-risk: no live Meta traffic is
flowing, so nothing can break. If it says `live`, there is a short window
between resetting the secret at Meta and updating Vercel where inbound webhooks
fail signature verification. They fail **closed** — `app/api/webhooks/meta/route.ts:31`
rejects rather than processes — and Meta retries for up to 36 hours, so a few
minutes costs nothing. Do it outside business hours anyway.

**Steps:**

1. <https://developers.facebook.com/apps/1597160428639176/settings/basic/>
2. Next to **App secret**, click **Reset**. Confirm with your password / 2FA.
3. Copy the new secret. Meta shows it once per reset, though you can always
   click **Show** again while logged in.
4. Update Vercel — remove then re-add, since `vercel env add` will not overwrite:

   ```bash
   npx vercel env rm META_APP_SECRET production
   npx vercel env add META_APP_SECRET production
   # paste the new secret at the prompt
   ```

5. Redeploy so the running instances pick it up. An env change alone does not
   affect the current deployment:

   ```bash
   npx vercel --prod
   ```

6. Update your local `.env.local` too, or local Meta work will start failing
   signature checks in a way that looks like a code bug.

**Verify:** the health endpoint reports Meta configuration state without ever
printing the secret.

```bash
curl -s https://app.rellooma.com/api/health | jq
```

**Do not** paste the new secret into this or any chat, a ticket, or a commit.
If you need me to confirm something about it, tell me its length or its first
four characters — never the value.

---

## 2. Fill the twelve legal placeholders

Twelve distinct values across three files. Several appear more than once, so
replace all occurrences of each.

> Do **not** touch `[IN BRACKETS]` in `src/components/ui/legal-page.tsx:28` —
> that is the sentence explaining the convention, not a placeholder.

### `app/terms/page.tsx`

| Line    | Placeholder               | What it needs                                                  |
| ------- | ------------------------- | -------------------------------------------------------------- |
| 16      | `[LEGAL ENTITY NAME]`     | Registered company name exactly as on the incorporation record |
| 42, 146 | `[SUPPORT CONTACT EMAIL]` | e.g. `support@rellooma.com`                                    |
| 83      | `[REFUND POLICY]`         | One sentence, or a link to a refund page                       |
| 114     | `[LIABILITY CAP]`         | e.g. "the fees you paid in the twelve months before the claim" |
| 142     | `[JURISDICTION]`          | Courts, e.g. "the courts of Istanbul, Türkiye"                 |

### `app/privacy/page.tsx`

| Line    | Placeholder               | What it needs                                                      |
| ------- | ------------------------- | ------------------------------------------------------------------ |
| 17, 140 | `[PRIVACY CONTACT EMAIL]` | e.g. `privacy@rellooma.com`                                        |
| 118     | `[SUBPROCESSOR LIST URL]` | A page listing Supabase, Vercel, Meta, Inngest, Cloudflare, Paddle |
| 145     | `[SUPERVISORY AUTHORITY]` | The DPA people may complain to — KVKK in Türkiye                   |
| 152     | `[PROCESSING REGIONS]`    | Where the data physically sits (your Supabase + Vercel regions)    |
| 153     | `[TRANSFER MECHANISM]`    | e.g. "Standard Contractual Clauses" if data leaves the region      |

### `app/data-deletion/page.tsx`

| Line        | Placeholder               | What it needs                                  |
| ----------- | ------------------------- | ---------------------------------------------- |
| 17, 53, 115 | `[PRIVACY CONTACT EMAIL]` | Same address as above                          |
| 80          | `[GOVERNING LAW]`         | e.g. "Türkiye"                                 |
| 116         | `[REGISTERED ADDRESS]`    | Full postal address — Meta checks this is real |

**Two things to know:**

- The addresses must actually receive mail. Meta App Review sends to the privacy
  contact, and a deletion request arriving at a dead mailbox is a compliance
  failure, not just an annoyance.
- Once the values are in, the **"Draft pending legal review"** banner in
  `src/components/ui/legal-page.tsx:25-31` should come out. Tell me when the
  values are in and I will remove it — it renders on all three pages and a
  reviewer reading "this has not been reviewed by a qualified lawyer" is a
  needless reason to reject.

I can apply the values if you give them to me. They are not secrets — a
registered address and a support email are published on the pages themselves.

---

## 3. Create the Paddle account

Full checklist is in [`docs/PADDLE_SETUP.md`](./PADDLE_SETUP.md). The parts only
you can do:

1. **Sandbox account** at <https://sandbox-vendors.paddle.com>. Use sandbox
   first — `PADDLE_ENVIRONMENT` defaults to it.
2. **Three products, one price each**: starter, growth, scale. Note the `pro_…`
   and `pri_…` identifiers and the amounts.
3. **Notification destination**: Developer Tools → Notifications → new
   destination at `https://app.rellooma.com/api/webhooks/paddle`, subscribed to
   the nine events listed in the setup doc. **Paddle shows the endpoint secret
   once — copy it immediately.**
4. **Set three env vars** (`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
   `PADDLE_ENVIRONMENT=sandbox`) the same way as in #1.

Then send me the `pri_…` / `pro_…` identifiers and amounts — those are not
secrets — and I will add catalogue v2 and write the adapter and webhook route.
Leave `PAYMENT_PROVIDER_MODE` alone until that exists; setting it to `paddle`
today throws on purpose.

**Note:** Paddle is a merchant of record and will ask for business
verification — company registration, bank details, sometimes a live site. That
approval can take days, which is why this is worth starting in parallel rather
than last.

---

## 4. Get the Meta pilot allowlisted

This is the long pole. Three separate things get conflated; they are not the
same:

| Thing                     | What it gives you                               | Needs                            |
| ------------------------- | ----------------------------------------------- | -------------------------------- |
| **Test users/numbers**    | Send to a handful of numbers you control, today | Nothing — just add them          |
| **Business verification** | Ability to submit for review                    | Company documents                |
| **App Review**            | Message real customers who are not test users   | Verification + legal URLs + demo |

### Do this now (unblocks development immediately)

WhatsApp gives you five test recipients without any review:

1. <https://developers.facebook.com/apps/1597160428639176/whatsapp-business/wa-dev-console/>
2. Under **To**, click **Manage phone number list**, add your own number.
3. That number can now receive messages from WABA `1706636060575887` with no
   review at all.

This is enough to prove the whole ingest → RCOS → send path end to end, which is
what G3's evidence requirement actually asks for.

### Then, for real customers

1. **Business verification** — App Dashboard → Business Verification. Company
   registration document plus proof of address. Takes a few days.
2. **Set the legal URLs** in App Settings → Basic. This is where #2 blocks you:
   - Privacy Policy URL: `https://app.rellooma.com/privacy`
   - Terms of Service URL: `https://app.rellooma.com/terms`
   - User Data Deletion: `https://app.rellooma.com/data-deletion`
3. **Submit for App Review** requesting `whatsapp_business_messaging` and, for
   Instagram, `instagram_manage_messages` and `pages_manage_metadata`. Each
   permission needs a screencast showing a real user granting consent and the
   feature working. Reviewers reject vague submissions — show the actual
   connect-account flow from the `/connections` page.
4. **Embedded Signup config id** — App Dashboard → WhatsApp → Configuration →
   the `configuration_id` from the Embedded Signup setup. Send it to me and I
   will set `META_WHATSAPP_CONFIG_ID`; it is not a secret.

### While waiting

`META_CONNECTION_MODE` stays `sandbox`. The live-send gate is fail-closed and
independent of App Review status, so there is no way to accidentally message a
real customer before you mean to.

---

## What to send me, and what never to send

**Safe to paste here** — these are published or public identifiers:

- the twelve legal values
- Paddle `pri_…` / `pro_…` identifiers and prices
- the Embedded Signup `configuration_id`
- App ID, WABA ID

**Never paste here.** Put these straight into Vercel and `.env.local`:

- the new `META_APP_SECRET`
- `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`
- any Supabase service role key
