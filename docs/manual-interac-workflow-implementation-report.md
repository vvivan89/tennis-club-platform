# Manual Interac workflow implementation report

Implemented on top of migrations 0045 and 0046; this update adds migration 0047.

- Member checkout supports Interac for individual/family memberships and paid event registrations. Amounts continue to be derived and validated server-side; Interac requests are recorded in `payments` as `provider='interac'`, `manual_review_status='submitted'`.
- Interac instructions and recipient email are configurable in Admin → Payments → Interac; disabled by default.
- Instructions are shown to the member and emailed when Resend is configured. Confirmation/rejection outcomes are emailed when Resend is configured.
- Admin Interac review supports confirm and reject-with-reason; the Investigate button and action were removed. The authenticated `review_manual_payment` RPC enforces admin authorization, permits administrators to confirm their own payments, locks the payment row, audits the action and performs fulfillment atomically.
- Admin Payments has Report, Stripe and Interac tabs. The report filters by year, all/membership/individual event and provider, with monthly and category charts and gross/refund/fee/net figures.
- CSV export is available for all transactions, Stripe, Interac and the selected report. Admin transaction loading paginates through the payments table.
- Stripe refunds use a compact amount field and icon button, prefilled with the remaining refundable amount. Confirmed Interac payments can be marked partially or fully refunded; the manual refund is recorded atomically with an audit entry and does not initiate a money transfer.
- Interac payment buttons are hidden from event and membership payment screens unless the admin has enabled Interac.
- Member payment history displays the payment method.

## Validation performed

- `node scripts/check-migrations.mjs` — passed (47 ordered migrations; 14 incremental files checked).
- `node scripts/check-rls.mjs` — passed static check (37 public tables with RLS enabled). This is not a live authorization test.
- TypeScript syntax scan found no parse errors. A full typecheck/build and automated tests could not be completed because project dependencies are not installed in this environment and package installation was unavailable offline.

Apply migration 0047 after 0046 before deploying the UI. Test the full payment and email paths in staging, including event cutoff and duplicate requests, before production.
