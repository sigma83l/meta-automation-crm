# Paddle setup

Everything in the billing authority is implemented and tested; what is missing
is an account. This is the checklist for connecting one. Until it is done, the
system is in a deliberate state: `PAYMENT_PROVIDER_MODE` cannot be set to
`paddle` without the code refusing to start, and the price catalogue contains
placeholder identifiers that resolution refuses to accept.

Nothing here can be done by an agent. Every step involves an external account
under the owner's control.

## What already exists

| Piece                          | Where                                                 | State                                   |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| Signature verification         | `src/modules/billing/providers/paddle/signature.ts`   | Complete, tested against local keys     |
| Event normalisation            | `src/modules/billing/providers/paddle/events.ts`      | Complete                                |
| Versioned price catalogue      | `src/modules/billing/providers/paddle/catalogue.ts`   | **Placeholder ids — needs the account** |
| Billing authority / projection | `src/modules/billing/authority.ts`                    | Complete                                |
| Usage ledger                   | `supabase/migrations/20260816120000_usage_ledger.sql` | Complete                                |
| Trial lifecycle                | `src/modules/billing/trial-lifecycle.ts`              | Complete                                |
| `PaymentProvider` adapter      | —                                                     | **Not written**; needs the account      |
| Webhook route                  | —                                                     | **Not written**; needs the secret       |

The adapter and route are deliberately absent rather than stubbed. A stub that
verifies nothing is worse than no stub at all, because it runs.

## Steps

### 1. Create the account and products

In the Paddle dashboard, create one product per paid plan (`starter`, `growth`,
`scale`) and one price per product. Note the `pro_...` and `pri_...`
identifiers.

Do this in **sandbox first**. `PADDLE_ENVIRONMENT` defaults to `sandbox`.

### 2. Fill in the catalogue

Add a **new version** to `src/modules/billing/providers/paddle/catalogue.ts`
with the real identifiers and real amounts. Do not edit `CATALOGUE_V1` in place.

The version exists so that an invoice raised under it can still be explained
later; editing a published version retroactively changes what past cycles were
priced under, and `billing_cycles.catalogue_version` will then point at
something that no longer describes them.

Set `CURRENT_CATALOGUE_VERSION` to the new version. `isCatalogueReadyForLive()`
is the check that it is complete — it refuses placeholder ids and zero amounts.

### 3. Create the notification destination

In Paddle: Developer Tools → Notifications → new destination pointing at
`https://<your-domain>/api/webhooks/paddle`, subscribed to at least:

```
transaction.completed          transaction.payment_failed
subscription.created           subscription.activated
subscription.updated           subscription.paused
subscription.resumed           subscription.canceled
subscription.past_due
```

Paddle shows the endpoint secret **once**. Copy it immediately.

### 4. Set the environment variables

```
PADDLE_API_KEY=<from Developer Tools → Authentication>
PADDLE_WEBHOOK_SECRET=<the destination secret from step 3>
PADDLE_ENVIRONMENT=sandbox
```

Put these in `.env.local` for local work and in the Vercel project settings for
deployed environments. They are secrets: never commit them, never paste them
into chat or a ticket.

Leave `PAYMENT_PROVIDER_MODE` alone for now — see step 6.

### 5. Write the adapter and the webhook route

With an account to test against, implement:

- `src/modules/billing/providers/paddle/paddle-payment-provider.ts`, satisfying
  `PaymentProvider` from `src/modules/billing/contracts.ts`. Its
  `verifyAndParseWebhook` should call `verifyPaddleSignature` on the **raw
  bytes** and then `normalizePaddleEvent`, in that order and with no parse in
  between.
- `app/api/webhooks/paddle/route.ts`, which must read the raw body (not
  `request.json()`), verify, persist durably, acknowledge, and only then
  process. The existing `app/api/webhooks/paytr/route.ts` is the reference for
  the acknowledge-then-process shape.
- Add `"paddle"` to `BillingProviderName` in `contracts.ts` and return the new
  adapter from the `case "paddle"` branch in `subscription-service.ts`, which
  currently throws.

### 6. Go live

Only after the sandbox path works end to end:

1. Repeat steps 1–4 against the production Paddle account.
2. `PADDLE_ENVIRONMENT=production`
3. `PAYMENT_PROVIDER_MODE=paddle`
4. `LIVE_BILLING_ENABLED=true` **and** `BILLING_LIVE_APPROVED=true` — both are
   required, deliberately, so that no single environment variable turns on real
   money movement.

## What is deliberately fail-closed

Worth knowing before debugging any of it, because each of these looks like a
bug the first time it fires:

- **Placeholder ids are refused.** `resolvePlanForPrice` returns
  `CONFIGURATION_MISSING` rather than a plan. An unfilled catalogue in front of
  a live webhook would otherwise entitle a workspace to a plan nobody bought.
- **An unknown price is refused.** A price created in the dashboard and never
  added to the catalogue yields `BILLING_PRICE_UNKNOWN`. This is not an attack
  signature; it is the normal consequence of adding a price in one place only.
- **`paddle` mode without an adapter throws at startup.** Falling through to
  the fake provider would mean a deployment configured for Paddle silently ran
  on an adapter that verifies no signature.
- **Only `transaction.completed` with a non-zero total raises an entitlement.**
  `subscription.activated` fires for trial activation too, and
  `subscription.updated` is agreement rather than payment.
- **Signatures older or newer than five minutes are rejected.** If verification
  starts failing everywhere, check clock skew on the server before suspecting
  the secret.
