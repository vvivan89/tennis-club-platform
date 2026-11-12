# Tennis Club Platform

Next.js 14, React, TypeScript, Tailwind CSS, shadcn/ui-style components, and Supabase.

## Current functionality

- Club landing page and published-event listing (real events load from Supabase; sample events are shown if the database is not configured or has no published events).
- Supabase Auth: email/password sign-in, sign-up, email confirmation callback, password-reset email, and password update.
- Server-rendered member dashboard with the signed-in member's membership and event registration records.
- Member profile editing.
- Protected administrator dashboard with live record counts.
- Initial PostgreSQL schema, row-level security policies, a private document bucket, and an atomic event-registration database function.

The application is a foundation, not a complete club-management product. Membership application/approval UI, waiver acceptance workflow, admin CRUD screens, payment checkout/webhooks, event registration UI, automatic waitlist promotion, and email notifications beyond Supabase Auth still need to be implemented and tested. Do not accept real payments or import real member data until those features and the deployment have been reviewed.

## 1. Install and run

Use Node.js 20 LTS or another version supported by the installed Next.js release.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## 2. Configure Supabase

1. Create a Supabase project under an account controlled by the club.
2. In Project Settings / API, copy the Project URL and the publishable key (or the legacy `anon` key if the project only exposes that key).
3. Add them to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted for older projects. Never put a service-role or secret key in a `NEXT_PUBLIC_` variable or commit `.env.local`.

4. For the original schema setup, the historical SQL starts with `supabase/migration_archive/0001_initial_schema.sql` and `supabase/migration_archive/0002_profile_birthday_skill_level.sql`. The archive preserves the complete migration history; `supabase/migrations/20261103000000_current_database_state.sql` is the current-state baseline for building a fresh database.
5. In Authentication → URL Configuration, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to the allowed redirect URLs. Add the production callback URL when deploying.
6. In Authentication → Providers → Email, decide whether email confirmation is required. The signup UI expects a confirmation email when confirmation is enabled.
7. In Authentication email templates, verify that confirmation and password recovery links use the configured callback flow.

The database migration is intended for a fresh project. If you already created tables or ran an earlier version of the migration, do not run it a second time unchanged: SQL enum/type/policy creation is not fully idempotent. Tell me what has already been run and create a follow-up migration instead.

## 3. Make the first account an administrator

First create the account through `/signup` and complete email confirmation if enabled. Then run this SQL in Supabase SQL Editor, replacing the email address with the exact account email:

```sql
update public.profiles
set role = 'admin', updated_at = now()
where lower(email) = lower('your-admin-email@example.com');
```

Verify that exactly one row was updated. Public signup cannot assign an administrator role. Keep administrator accounts limited to trusted club officers.

## 4. Test the integration

- Sign up at `/signup`.
- Confirm the email if Supabase requires confirmation.
- Sign in at `/login`.
- Check `/dashboard` and `/profile`.
- Make the account an admin using the SQL above, sign out and back in, and check `/admin`.
- Create a published test event in Supabase and verify it appears on the landing page.
- Confirm unauthenticated users cannot open `/dashboard` or `/admin`.
- Test RLS policies with separate member accounts before storing real member data.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Environment and security

- `.env.local` is ignored by Git. Do not share or upload it.
- Supabase Auth sessions use secure server-side cookie handling and middleware refresh.
- The database uses row-level security; policies are essential and should be reviewed before launch.
- The `club-documents` bucket is private. The current storage policy permits authenticated members to read objects in that bucket and only admins to upload/update/delete them.
- The registration function validates membership, opening/closing times, and capacity atomically. It is not yet wired to a registration UI or payment checkout.
- Payment state must only be updated by a trusted server-side payment webhook after verifying the provider's signature.

## Stripe payments (test mode)

Copy `.env.example` to `.env.local` and configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Configure the Stripe webhook to target `/api/webhooks/stripe` with payment-intent processing/succeeded/failed/canceled, `charge.refunded`, and `checkout.session.expired` events. For existing databases, apply only unapplied incremental migrations from `supabase/migrations/`; historical SQL source files are in `supabase/migration_archive/`. Do not rerun the current-database baseline against an existing database. See `docs/payments-foundation.md` for checkout and verification details. Start with Stripe test mode and test cards only.
