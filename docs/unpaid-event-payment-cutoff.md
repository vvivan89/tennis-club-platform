# Unpaid event-registration payments

The `/api/notifications/pending-event-payments` route is scheduled every minute by `vercel.json`.

For production, configure these server-side environment variables:

- `CRON_SECRET`: a long random secret. Vercel sends it as a bearer token to scheduled functions.
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`: a sender address on a domain verified in Resend.

Apply `supabase/migration_archive/0044_unpaid_event_registration_reminders.sql` to an existing database at the corresponding migration level before deploying the route. The migration adds an RLS-protected, service-role-only log with a unique reminder per registration and reminder type.

For registrations that are confirmed but have `payment_status` of `pending` or `failed`, the scheduled route:

1. Sends one reminder approximately 24 hours before the event's `registration_closes_at`.
2. Sends one reminder approximately one hour before that cutoff.
3. At or after the cutoff, checks Stripe for a successful Checkout Session/PaymentIntent before taking action. A successful Stripe payment is reconciled and fulfilled rather than removing the member.
4. Cancels an unpaid registration and sets its payment status to `failed`; it also expires an open Checkout Session where possible.

The route honors the member's `email_registration_reminders` preference. Reminder attempts are recorded per registration, so withdrawing and registering again creates a new reminder lifecycle.

**Timing precision:** Vercel cron runs at minute granularity. Removal occurs on the first successful scheduled run at or after the cutoff, normally within one minute, not at an exact second. If the cron request or Stripe/database verification fails, the route deliberately leaves the registration in place and retries on the next run rather than risk removing a member whose payment succeeded.

The application must be deployed with the new `vercel.json` for the cron schedule to become active. In local development, invoke the route manually with `Authorization: Bearer <CRON_SECRET>` to test it; do not expose the service-role key to the browser.
