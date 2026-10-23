# Incremental migrations

The distributable project intentionally contains the consolidated schema/history in `supabase/consolidated_migrations.sql` rather than the old individual migration files.

For a new schema change:

1. Add a new numbered SQL file here, continuing the sequence from the latest migration represented in the consolidated file.
2. Append the migration to `supabase/consolidated_migrations.sql`, preserving its content and wrapping it in `-- BEGIN MIGRATION: <filename>` and `-- END MIGRATION: <filename>` markers.
3. Run `npm run check:migrations` and `npm run check:rls`.
4. Apply only the new incremental migration to an existing database. Use the consolidated file only to initialize a fresh database; do not apply it over an existing schema.

Original historical individual migration files are retained separately for project history and are not part of the distributable ZIP.
