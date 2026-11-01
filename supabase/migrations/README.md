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
- `0045_manual_interac_payment_review.sql`: adds Interac review metadata and notes, administrator-only authenticated review RPC with row locking, stricter payment fulfillment validation, rejection-state updates, and provider-preserving paid-registration reuse. Application UI, payment initiation APIs, and notification delivery remain separate implementation work.

Chat notification preferences are stored as `all`, `mentions`, or `none`. Mention recipient IDs are validated against approved profiles by the database trigger. Chat messages remain excluded from audit logging.


- `0046_interac_configuration.sql` — configurable Interac e-Transfer instructions and admin RLS.
- `0062_integrated_league_tournaments.sql`: adds League as a shared series mode on the existing doubles tournament and ladder identity, fixes confirmed pairs across events, and stores historical and current standings.
- `0063_league_after_event_standings.sql`: stores post-event League standings including results and teams from the current event.
- `0064_league_overview_scores.sql`: lets fixed League team members submit their match scores through the event Overview.
- `0065_fix_league_pair_creation_search_path.sql`: fixes League pair creation by qualifying both participant table references in the trigger function.
- `0066_league_teams_fixed_on_pair_creation.sql`: creates fixed League teams with the first pair and lets event managers replace a team member across later event pairs while retaining completed match-player records.
- `0067_league_team_court_assignments.sql`: adds a court assignment modal backend that assigns fixed League pairs in time slots, with two teams (four player places) per court.
- `0068_league_pair_membership_eligibility.sql`: requires active paid membership for League pair creation and exposes eligibility to the League admin interface.
- `0069_league_participant_member_selector_eligibility.sql`: exposes eligibility for all members in the League admin participant selector, including members not yet registered for the event.
- `0070_allow_overfull_league_courts_with_warning.sql`: allows saving League assignments above four player places after the admin confirms the court warning.
- `0073_atomic_league_event_team_registration.sql`: registers both members of an established League team and creates their event pair in one authorized, idempotent transaction.
- `0074_atomic_league_event_team_withdrawal.sql`: withdraws both members and their League event pair atomically.
- `0075_league_single_player_registration.sql`: lets approved active members without a confirmed League partner register singly for a League event.
- `0076_league_event_score_start_guard.sql`: blocks all League score entry before the event starts and publishes court assignments for Realtime updates.
