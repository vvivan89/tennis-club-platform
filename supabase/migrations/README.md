# Supabase migrations

`20261103000000_current_database_state.sql` is the only active migration. It replays the ordered SQL effects needed to build the current schema on an empty local database. Its historical source files are preserved in `supabase/migration_archive/`, and `supabase/consolidated_migrations.sql` remains the unchanged historical reference.

Use `pnpm supabase db reset` to rebuild the local database from this baseline. **This drops and recreates the local database and all data in it.** Do not apply this baseline to an existing database or a hosted project; it is intended for a fresh local reset only. Existing databases should continue using their recorded migration history.

The baseline removes the per-migration `BEGIN`/`COMMIT` wrappers while preserving the original SQL order, so Supabase sees one migration file. It drops and recreates `event_scoreboard` at its historical redefinitions because PostgreSQL cannot remove columns through `CREATE OR REPLACE VIEW`. Run `pnpm check:migrations` to verify the baseline still matches the archived history and consolidated SQL.
