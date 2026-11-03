-- BEGIN MIGRATION: 0004_club_contact_social_links.sql
alter table public.club_settings add column if not exists social_links jsonb not null default '[]'::jsonb;
alter table public.club_settings add column if not exists location_url text not null default '';
-- END MIGRATION: 0004_club_contact_social_links.sql
