-- BEGIN MIGRATION: 0005_member_management_public_contacts.sql
-- Membership payment tracking, map location, and public officer contacts.
alter table public.memberships add column if not exists payment_status text not null default 'unpaid' check (payment_status in ('paid','unpaid'));
alter table public.club_settings add column if not exists location_query text not null default '';
create table if not exists public.club_contacts (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
 position text not null, emails text[] not null default '{}', phones text[] not null default '{}',
 is_public boolean not null default false, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.club_contacts enable row level security;
create policy "Admins manage club contacts" on public.club_contacts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create or replace view public.public_club_contacts as
 select cc.id, cc.position, cc.emails, cc.phones, cc.sort_order, p.full_name, p.avatar_url
 from public.club_contacts cc join public.profiles p on p.id=cc.profile_id where cc.is_public=true;
grant select on public.public_club_contacts to anon, authenticated;
-- END MIGRATION: 0005_member_management_public_contacts.sql
