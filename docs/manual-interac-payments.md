# Manual Interac e-Transfer payments

Migrations `0045_manual_interac_payment_review.sql` and `0046_interac_configuration.sql` provide the Interac payment review workflow and configurable payment instructions. Migration `0047_manual_interac_refunds_and_review_policy.sql` adds manual refund records and updates administrator review permissions.

## Admin setup

1. Apply migrations 0045, 0046, and 0047 from the historical SQL in `supabase/migration_archive/` when upgrading a database at that migration level. Do not replay the current-database baseline on an existing database.
2. Open Admin → Payments → Interac.
3. Enter the club's Interac recipient email and transfer instructions, then enable Interac and save. Interac stays disabled until the recipient email and instructions are valid.
4. Review incoming requests in the Interac table. Confirm only after verifying receipt in the club's bank account; administrators may confirm their own payments, and the action is recorded in the audit log. Rejection requires a reason. Confirmed Interac payments can be marked partially or fully refunded with an optional note; this records the refund in PCTC and does not transfer money.

## Member flow

Members can choose Interac when paying an individual/family membership or a paid event registration. The server derives the amount from the existing membership/event record; the browser cannot set an amount. A pending payment request is recorded in the same `payments` ledger and the member receives the transfer instructions in the UI and, when Resend is configured, by email. Membership/event fulfillment happens only after the admin confirmation RPC validates the payment and associated record atomically.

## Operational notes

- Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (or the existing supported sender fallbacks) for emails. Email delivery failure does not silently mark a payment paid.
- The Payments report includes all providers and successful payments net of recorded refunds, with year, membership/event and provider filters. CSV exports include transaction IDs, provider, purpose, amounts, statuses and dates.
- Stripe remains on its existing webhook/refund path. The Interac refund path is an accounting record only and does not invoke Stripe APIs or send money. Interac payment buttons are hidden on membership and event pages while Interac is disabled.
- Test with a staging Supabase project before production, including duplicate submissions, rejection, family membership confirmation, event registration confirmation, email failure, and the event registration cutoff. The static RLS check does not replace live authorization testing.
