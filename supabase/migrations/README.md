# Supabase migrations

`20261103000000_current_database_state.sql` builds the current schema on an empty local database. Historical migrations are preserved individually in `supabase/migration_archive/`. New incremental migrations belong in this directory and should also be archived under the same filename.

Use `pnpm supabase db reset` to rebuild a disposable local database from the baseline and any later incremental migrations. **This drops and recreates the local database and all data in it.** Do not apply the baseline to an existing database or hosted project; existing databases should apply only unapplied incremental migrations.

Run `pnpm check:migrations` to verify active incremental migrations match their archived copies and the current-database baseline is present. Run `pnpm check:rls` to check the baseline's public-table RLS coverage.
