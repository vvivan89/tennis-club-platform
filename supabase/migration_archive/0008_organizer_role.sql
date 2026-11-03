-- BEGIN MIGRATION: 0008_organizer_role.sql
-- Add the organizer role in a separate migration so the new enum value is committed
-- before policies and functions reference it in migration 0009.
ALTER TYPE public.club_role ADD VALUE IF NOT EXISTS 'organizer';
-- END MIGRATION: 0008_organizer_role.sql
