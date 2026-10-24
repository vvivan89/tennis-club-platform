# Supabase migrations

`supabase/consolidated_migrations.sql` contains the complete migration history in chronological order and is the reference SQL bundle for a fresh database. Do not run the consolidated bundle against an existing database that has already applied earlier migrations.

For an existing PCTC database that has already applied migrations through `0036_chat_member_display_names.sql`, apply `0037_chat_presence_cleanup_pagination.sql` once. It adds the indexed unread-count cursor, publishes read-marker changes to Realtime, and queues image paths when messages are deleted or pruned. The app's authenticated `/api/member/chat/cleanup-images` endpoint processes that queue using the server-only `SUPABASE_SERVICE_ROLE_KEY` environment variable.

Chat notification preferences are stored as `all`, `mentions`, or `none`. Mention recipient IDs are validated against approved profiles by the database trigger. Chat messages remain excluded from audit logging.
