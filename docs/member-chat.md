# Member chat

The member portal contains one shared group chat for profiles whose `application_status` is `approved`.

## Database setup

The original chat schema change is preserved at `supabase/migration_archive/0034_member_group_chat.sql`. The active migrations directory contains the current-database baseline and later incremental migrations; do not replay the baseline on an existing database. The chat migration creates message and read-marker tables, RLS policies, a private image bucket limited to 1 MB, a five-minute edit/delete guard, a 2,000-message retention trigger, and Realtime publication for chat messages.

The bucket allows JPEG, PNG, GIF, and WebP images. Images are stored privately and displayed using short-lived signed URLs. Supabase Storage enforces the configured 1 MB limit in addition to the client-side validation.

## Security model

The server-rendered `/member/chat` page redirects unauthenticated users to sign in and redirects profiles that are not approved to the member dashboard. RLS independently restricts message and read-marker access to authenticated approved members. A user can edit or delete only their own messages and only within five minutes; the database trigger enforces this even if the browser is modified. Administrators have the same author-only message permissions as other members.

The chat is intentionally excluded from audit logging. Realtime Presence is used for online status. Unread counts are based on messages from other users created after the member's last-read timestamp.

## Operational notes

- Apply the migration before deploying the new chat UI.
- Realtime and Storage must be enabled in the Supabase project.
- Message history is capped at the newest 2,000 rows. Image files associated with automatically pruned messages may require a separate storage cleanup policy if image usage becomes significant.
- Automated unit tests verify client-side rules and the migration's schema/security contract. Live RLS, Storage, Realtime, and concurrent-retention behavior still require verification against a dedicated Supabase test project; no live database credentials are included in the repository.


## Presence, unread badges, pagination, and image cleanup

- Connected presence is owned by the app-wide `MemberChatNotifications` component and remains active on any page while an approved member is signed in. It uses one shared Supabase Realtime Presence channel per browser session; the chat view consumes the resulting online-user list.
- The navigation unread badge is event-driven. It refreshes on message and own read-marker Realtime changes, after subscription reconnects, and on browser focus/visibility changes. There is no fixed-interval badge polling. The count query is a `HEAD` request with an exact count, and the retained history is capped at 2,000 messages. Migration `0037_chat_presence_cleanup_pagination.sql` adds a composite index on `(created_at, user_id)` for this filter.
- Message history loads 100 messages per page, newest page first, with older pages appended when requested. The SQL query fetches one extra row to determine whether another page exists.
- Deleting a message or pruning it from the 2,000-message retention window queues its image path in `member_chat_image_cleanup_queue`. The authenticated `/api/member/chat/cleanup-images` route uses `SUPABASE_SERVICE_ROLE_KEY` to delete queued objects from the private Storage bucket and then clears the queue. The route is invoked when the chat opens and after sending/deleting a message, so retention-pruned image files are cleaned after the message that caused pruning is sent. Ensure `SUPABASE_SERVICE_ROLE_KEY` is configured server-side; it must never use a `NEXT_PUBLIC_` prefix.
- Chat remains excluded from audit logging.
