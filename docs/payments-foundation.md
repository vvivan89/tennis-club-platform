# PCTC payments and Stripe checkout

## Implemented flows

The application now has server-created Stripe Checkout for individual membership, family membership, and paid event registration; webhook-driven fulfillment; member payment history; and an administrator refund interface.

- Membership prices come from `membership_plan_settings` on the server. Individual membership requires accepting the current membership waiver. The server creates or reuses a pending membership record for the current season. A verified successful payment activates it and marks it paid.
- Family checkout is associated with a family group for the current season. Each confirmed family member must accept the current waiver version. When a family group belongs to a prior season, the checkout flow creates a new season group and copies currently confirmed members, carrying forward waiver acceptance only if it still matches the current waiver version.
- Paid event checkout is associated with a confirmed registration. Waitlisted registrations are not charged. The server checks the event price, registration owner, status, and registration window before creating checkout. Verified payment fulfillment marks the registration paid.
- The success/return page displays status fetched from the server. A redirect parameter alone never marks a payment paid.
- `/member/payments` shows a member's payment history. `/admin/payments` lets an authorized administrator request full or partial refunds. Refund records and aggregate status are reconciled from Stripe webhooks.

## Required environment variables

Set these in the server deployment environment or local `.env.local`; never expose secret values through `NEXT_PUBLIC_*` variables.

- `STRIPE_SECRET_KEY`: Stripe secret key. Use `sk_test_...` for development/testing and `sk_live_...` only after production review.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the corresponding Stripe webhook endpoint.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-side payment persistence. The service-role key must never be exposed to the browser.
- Existing Supabase browser/server auth variables and optional email variables as configured by the project.

Copy `.env.example` to `.env.local` and replace the placeholders. Do not commit `.env.local` or real credentials.

## Webhook setup

Configure a Stripe webhook endpoint targeting `/api/webhooks/stripe` with these event types:

- `payment_intent.processing`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

For local development, use Stripe CLI to forward test events to the local route and set the CLI-provided `whsec_...` value in `.env.local`. The webhook verifies the raw request body signature before processing. Do not disable signature verification. Keep test/live secret keys and webhook signing secrets paired.

The webhook validates internal payment references, metadata, amount, currency, and Stripe identifiers. Completed Checkout Sessions are reconciled directly as well as PaymentIntent events, so endpoints configured for Checkout Session events can confirm a payment. The authenticated payment-status endpoint also reconciles a completed, paid Checkout Session against Stripe before updating local state. Event claims are idempotent; failed processing can be retried. The successful-payment fulfillment function updates the relevant membership, family membership, or event registration idempotently.

## Database migrations

Apply unapplied migrations in numeric order. For the current payment implementation, apply `0041_payment_fulfillment.sql` after `0039_payments_foundation.sql` and `0040_membership_payment_schema_compat.sql`. The migration adds family waiver acceptance fields, an active-payment uniqueness guard, a service-role-only fulfillment function, current-season membership eligibility, and reconciles event roster/scoreboard views and policies with the current payment schema.

Do not run `supabase/consolidated_migrations.sql` against an existing database; it is the full history for a fresh database only. The consolidated file has been updated to include migration 0041.

## Lifecycle, refunds, and security

Payment amounts are integer minor units (CAD $12.50 is `1250`). The browser cannot supply a price. Stripe Checkout uses server-generated line items and idempotency keys. Payment statuses are `pending`, `processing`, `succeeded`, `failed`, `canceled`, `partially_refunded`, and `refunded`. Payment state transitions are constrained by the database trigger.

RLS remains enabled on payment tables. Authenticated users can read their own payments/refunds; trusted server-side routes use the service-role client after checking the authenticated user's profile and permissions. Only approved administrators can request refunds. The admin response records that Stripe accepted the refund request; the webhook updates the payment/refund ledger. A successful payment redirect is never proof of payment.

The app does not store card numbers or CVCs. Refunds do not automatically revoke memberships or cancel event registrations because the repository does not define a refund-revocation policy. Review the club's policy before production.

## Test and deploy checklist

1. Apply migrations 0039, 0040, and 0041 as appropriate for the target database.
2. Configure Stripe test-mode secret and webhook signing secrets.
3. Confirm `membership_plan_settings` contains intended CAD prices and the active membership waiver is legally reviewed. The repository's seeded waiver is explicitly a placeholder and must not be treated as a reviewed legal document.
4. Test individual membership checkout and verify the membership becomes active/paid only after the signed webhook is processed.
5. Test family checkout with multiple confirmed family members; ensure each has accepted the current waiver.
6. Test a paid event registration, payment failure/retry, Checkout Session expiration, and withdrawal while checkout is pending.
7. Test duplicate webhook delivery, failed webhook retry, partial refund, and full refund.
8. Test member and administrator access controls with separate accounts.
9. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm check:migrations`, `pnpm check:rls`, `pnpm test`, and `pnpm build` after installing dependencies. Run E2E and live database tests in a disposable/test environment before deployment.

## Current limits

This implementation has not been tested against a live Stripe account or the user's Supabase database in this environment. The complete project quality suite could not run because dependencies were not installed and the environment could not fetch them. Do not enable live mode until automated checks, database migration execution, Stripe test-mode flows, and waiver/refund policy review have passed.


## Payment history proceeds and refund reconciliation

Migration `0043_payment_proceeds_and_reuse.sql` adds `stripe_fee_minor` and `proceeds_minor`, populated from Stripe's charge balance transaction. The payment history displays net proceeds after subtracting recorded refunds. Existing successful payments are reconciled from Stripe on payment-history page loads when proceeds have not yet been recorded. Admin refund requests immediately persist the returned Stripe refund and refresh payment history; the signed `charge.refunded` webhook remains the retry/reconciliation path.

The same migration updates `register_for_event`: when a member withdraws from an event and later registers again, a confirmed registration can reuse a prior successful payment for that same event and price only if the payment has never been refunded. Waitlisted registrations are not marked paid.
