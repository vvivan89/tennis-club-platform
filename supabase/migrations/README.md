# Supabase migrations

`supabase/consolidated_migrations.sql` contains the complete migration history in chronological order and is the reference SQL bundle for a fresh database. Do not run the consolidated bundle against an existing database that has already applied earlier migrations.

For an existing database, apply only migrations it has not yet applied, in numeric order. The current incremental migrations are:

- `0037_chat_presence_cleanup_pagination.sql`: indexed unread-count cursor, Realtime publication for read markers, and cleanup queue for deleted/pruned chat images.
- `0038_chat_member_avatars.sql`: narrowly scoped approved-member avatar lookup for chat.
- `0039_payments_foundation.sql`: payment/refund ledgers, payment lifecycle constraints, RLS policies, and idempotent Stripe webhook event inbox.
- `0040_membership_payment_schema_compat.sql`: updates membership eligibility helpers to use the current payment purpose, business-record ID, and succeeded status instead of removed legacy payment columns and statuses.
- `0041_payment_fulfillment.sql`: adds per-family-member waiver acceptance, an idempotent service-role-only payment fulfillment function, an active-payment uniqueness guard, and reconciles event roster/scoreboard views and eligibility policies with the current payment schema.
- `0042_payment_ui_and_webhook_reconciliation.sql` exposes registration payment status in the event roster so pending paid registrations can be labeled correctly. The application webhook and status endpoints also reconcile verified completed Checkout Sessions.
- `0043_payment_proceeds_and_reuse.sql`: records Stripe fees/net proceeds and safely reuses an eligible non-refunded tournament payment when a member re-registers.
- `0044_unpaid_event_registration_reminders.sql`: records 24-hour and 1-hour unpaid event-registration payment reminders per registration. The minutely `/api/notifications/pending-event-payments` cron sends reminders and cancels unpaid confirmed registrations at/after their cutoff after checking Stripe for late-arriving successful payments.

Chat notification preferences are stored as `all`, `mentions`, or `none`. Mention recipient IDs are validated against approved profiles by the database trigger. Chat messages remain excluded from audit logging.

