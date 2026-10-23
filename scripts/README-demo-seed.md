# Demo data seeder

Run from the project root with `npm run seed:demo`. Before running, open `scripts/seed-demo-data.mjs` and paste your Supabase project URL and server-side secret/service-role key into the constants near the top. Do not commit the key.

## What the reset removes

The seeder first removes records created by earlier runs of this seeder: Auth users matching `demo.admin@example.com` and `demo.member###@example.com`, memberships and family records belonging to those users, their registrations/payments, events with the `pctc-demo-` slug prefix, demo-authored news, and associated event/notification data. It then recreates the dataset. It does not truncate tables or delete unrelated users/events/news. The reset also clears references to the old demo accounts from a few optional audit/creator fields so those demo Auth users can be deleted cleanly.

This is a destructive reset of the seeder-owned demo dataset. Use only against your development/test Supabase project.

## Scores and the two-day rule

The seeder creates scores for past non-tournament sessions so historical scoreboard pages can be tested. If the database has the `block_old_event_scores` trigger enabled, temporarily disable it in Supabase SQL Editor before seeding:

```sql
ALTER TABLE public.event_scores DISABLE TRIGGER block_old_event_scores;
```

Run `npm run seed:demo`, then immediately restore the application rule, even if seeding fails:

```sql
ALTER TABLE public.event_scores ENABLE TRIGGER block_old_event_scores;
```

Verify the trigger state with:

```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'block_old_event_scores';
```

The expected `tgenabled` value is `O`.

## Generated dataset

- 100 unique demo accounts (one administrator and 99 members), with varied application and membership statuses.
- Single/family memberships, payment records, and family-group links.
- 18 past sessions and 8 upcoming sessions. Sessions whose registration window has not opened are left unregistered; open sessions include registrations and waitlists. Past sessions include court assignments and historical scores.
- 5 published news posts with realistic titles and content.

All seeded users use the same password configured in `DEMO_PASSWORD`. Default admin: `demo.admin@example.com`; example member: `demo.member002@example.com`.
