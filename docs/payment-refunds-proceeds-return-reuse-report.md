# Payment refunds, proceeds, return navigation, and tournament payment reuse

## Implemented

- Admin refund requests now immediately upsert the returned Stripe refund, retrieve the associated charge, and update the payment's refund total and status. The signed `charge.refunded` webhook retrieves the current expanded refund list and remains the reconciliation/retry path. Admin history refreshes after a refund request; payment history pages refresh periodically so member views pick up asynchronous refund changes.
- Added `stripe_fee_minor` and `proceeds_minor` to `public.payments`. On successful PaymentIntent processing, the app retrieves the Stripe balance transaction and persists its fee and net. History pages display net proceeds after subtracting refunds and backfill up to 20 historical records per page render.
- Checkout requests carry a validated same-origin return path and tailored button label. The return page shows one contextual back button, and after a fully confirmed/fulfilled payment it displays a 10-second countdown and automatically navigates back.
- Migration 0043 updates `register_for_event` to reuse a prior successful, never-refunded payment for the same event and price when the member re-registers after withdrawing. It only marks a new registration paid when the member receives a confirmed place; waitlisted registrations remain unpaid. The event page checks the created registration's `payment_status` and skips checkout when the prior payment was reused.

## Migration

For a database with migrations 0039 through 0042 applied, apply the historical SQL at `supabase/migration_archive/0043_payment_proceeds_and_reuse.sql`. Do not replay the current-database baseline or truncate data.

## Verification

Migration consistency and static RLS checks passed. The archive's full typecheck, lint, unit tests, and production build could not be run because dependencies were not installed in this environment. No live Supabase or Stripe transaction was executed; validate refunds, return navigation, balance transaction proceeds, and withdrawn/re-registered tournament scenarios in Stripe test mode before production.
