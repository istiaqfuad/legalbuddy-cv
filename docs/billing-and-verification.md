# Billing and lawyer verification

## Plans and prices

One Stripe Product per plan (names stay distinct on Checkout and
invoices): Lite is free with no Stripe object; Professional ~$12.99/mo;
Business ~$19.99/mo. The catalog is created by
`web/scripts/stripe-setup.mjs` (idempotent by lookup key); Price IDs go in
`STRIPE_PRICE_PROFESSIONAL` / `STRIPE_PRICE_BUSINESS`.

## How money moves

- Signup with a paid plan (or Pricing page, or onboarding) calls
  `POST /api/billing/checkout`, which creates/reuses the Stripe Customer
  and returns a Checkout Session in subscription mode. Success lands on
  `/billing/success`, which polls `GET /api/billing/status` until the
  webhook flips the plan, then routes onward.
- Plan changes, cancellation, and payment method updates are self-serve
  through the Customer Portal (`POST /api/billing/portal`).
- Fulfillment lives ONLY in `POST /api/billing/webhook` (signature
  verified with `STRIPE_WEBHOOK_SECRET`). Handled: `checkout.session.*`
  (paid only), `customer.subscription.*`, `invoice.paid/failed`, plus the
  risk side (`charge.dispute.created`, `charge.refunded`,
  `radar.early_fraud_warning.created`) which marks the subscription
  `disputed`. Local `plan`/`subscription_status` columns are a cache of
  Stripe, never written from the client.
- Quota: Lite gets `LITE_DAILY_MESSAGES` assistant answers per UTC day
  (default 20); active/trialing paid plans are unlimited; lapsed or
  disputed subscriptions fall back to Lite. The chat route returns 402,
  and the UI shows an upgrade banner instead of the generic error.

## Testing webhooks locally

Forward test events with the Stripe CLI (the signing secret it prints
goes in `STRIPE_WEBHOOK_SECRET`):

```bash
stripe listen --forward-to localhost:3001/api/billing/webhook --api-key "$STRIPE_SECRET_KEY" \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,charge.dispute.created,charge.refunded,radar.early_fraud_warning.created
```

Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
The current `.env` secret belongs to such a listener (test mode); replace
it with the Dashboard endpoint secret for production.

## Lawyer verification

Bangladesh has no public, machine-checkable advocate roll: the Bar
Council site publishes exam-result PDFs, not a member directory, and an
automated vision read was tried and dropped because the model refuses to
transcribe ID documents (verified live against a Sanad scan). So
verification is document-based with human review:

1. Lawyer submits name as printed on the Sanad, Sanad/enrollment number,
   enrollment date, and bar association, plus a photo or PDF (10 MB max).
2. The scan goes to the private object-storage bucket
   (`lawyer-sanads/<userId>/<uuid>-<file>`); only the key is stored in
   `lawyer_verifications`. The account flips to `role = 'lawyer'`,
   `lawyer_status = 'pending'`.
3. An admin opens the scan via a presigned URL
   (`GET /api/lawyer/verify?userId=…`, `ADMIN_EMAILS` only) and approves
   or rejects with a note (`PATCH /api/lawyer/verify`). The reviewer
   checks the scan against the Bar Council roll.

Set `ADMIN_EMAILS` to enable review; until then submissions queue safely
as pending.

## Accounts

Signup is a three-step form (account type, details, plan): Individual,
Business (adds company name), or Lawyer (verification after signup).
Google signups finish the same steps on `/onboarding`; `/post-login`
routes by `onboarded` and verification state. Lawyers subscribe to the
same Professional plan as everyone else; enrollment proves who they are,
the subscription pays for the service.

## Tax note

If you charge US or EU customers, enable Stripe Tax alongside Billing
(see recurring-payment tax setup in the Stripe docs) — and only after
holding an active tax registration, otherwise Stripe calculates nothing
and shows no error. Bangladesh VAT on digital services is your
accountant's call; `automatic_tax` stays off.
