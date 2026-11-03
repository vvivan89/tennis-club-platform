-- Squashed fresh-database migration, derived from the ordered historical migrations.
-- For an empty local database only; existing databases must not replay this baseline.

-- Port Coquitlam Tennis Club initial schema. Apply through Supabase migrations after reviewing club policies.
create extension if not exists pgcrypto;

create type public.member_status as enum ('pending','active','expired','suspended');
create type public.event_status as enum ('draft','published','cancelled');
create type public.registration_status as enum ('confirmed','waitlisted','cancelled');
create type public.club_role as enum ('member','admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null,
  avatar_url text,
  date_of_birth date,
  show_birthday_emoji boolean not null default false,
  tennis_skill_level text check (tennis_skill_level in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0')),
  role public.club_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_type text not null,
  status public.member_status not null default 'pending',
  starts_on date,
  ends_on date,
  renewal_enabled boolean not null default false,
  waiver_version text,
  waiver_accepted_at timestamptz,
  waiver_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique,
  description text,
  event_type text not null check (event_type in ('social','program','tournament')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  registration_opens_at timestamptz not null,
  registration_closes_at timestamptz,
  capacity integer not null check (capacity > 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  members_only boolean not null default true,
  status public.event_status not null default 'draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (registration_closes_at is null or registration_closes_at > registration_opens_at)
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.registration_status not null,
  queue_position bigint,
  payment_status text not null default 'not_required' check (payment_status in ('not_required','pending','paid','refunded','failed')),
  payment_provider text,
  provider_reference text,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,user_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  membership_id uuid references public.memberships(id),
  registration_id uuid references public.registrations(id),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),
  provider text not null check (provider in ('stripe','paypal','etransfer','cash','cheque','other')),
  status text not null check (status in ('pending','paid','failed','refunded','recorded_manually')),
  provider_reference text,
  recorded_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'general',
  storage_path text not null,
  visible_to_members boolean not null default true,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.waiver_versions (
  version text primary key,
  title text not null,
  body text not null,
  effective_at timestamptz not null,
  active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index events_public_schedule_idx on public.events(status, starts_at);
create index events_registration_open_idx on public.events(registration_opens_at);
create index registrations_event_status_idx on public.registrations(event_id, status, created_at);
create index memberships_user_status_idx on public.memberships(user_id, status);
create index payments_user_created_idx on public.payments(user_id, created_at desc);

-- Create a profile automatically when an authenticated user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') not in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') then
    raise exception 'A valid tennis skill rating is required to register.';
  end if;
  if coalesce(trim(new.raw_user_meta_data ->> 'phone'), '') = '' then raise exception 'A phone number is required to register.'; end if;
  insert into public.profiles (id, email, full_name, phone, tennis_skill_level)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''), trim(new.raw_user_meta_data ->> 'phone'), new.raw_user_meta_data ->> 'tennis_skill_level');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Only server-side trusted processes should update payment status after verifying provider webhooks.
-- Admin roles must be assigned deliberately by a trusted operator, never from public signup metadata.

create table public.news (id uuid primary key default gen_random_uuid(), title text not null, body text not null, published boolean not null default false, published_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.club_settings (id integer primary key default 1 check (id = 1), club_name text not null default 'Port Coquitlam Tennis Club', short_name text not null default 'PCTC', description text not null default '', contact_email text not null default '', contact_phone text not null default '', website_url text not null default '', updated_at timestamptz not null default now());
insert into public.club_settings (id) values (1) on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.payments enable row level security;
alter table public.documents enable row level security;
alter table public.waiver_versions enable row level security;
alter table public.news enable row level security;
alter table public.club_settings enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

create policy "Members read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "Members update own profile" on public.profiles for update to authenticated using (id = (select auth.uid()) and role = 'member') with check (id = (select auth.uid()) and role = 'member');
create policy "Admins manage profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read own memberships" on public.memberships for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "Admins manage memberships" on public.memberships for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Published events visible" on public.events for select to anon, authenticated using (status = 'published' or public.is_admin());
create policy "Admins manage events" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read own registrations" on public.registrations for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "Admins manage registrations" on public.registrations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read own payments" on public.payments for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "Admins manage payments" on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read permitted documents" on public.documents for select to authenticated using (visible_to_members or public.is_admin());
create policy "Admins manage documents" on public.documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Members read active waiver" on public.waiver_versions for select to authenticated using (active or public.is_admin());
create policy "Admins manage waivers" on public.waiver_versions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Public read published news" on public.news for select to anon, authenticated using (published or public.is_admin());
create policy "Admins manage news" on public.news for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Public read club settings" on public.club_settings for select to anon, authenticated using (true);
create policy "Admins manage club settings" on public.club_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Atomic registration: serializes attempts for an event, enforces opening time/capacity, and queues excess users.
-- Payment-required events are not confirmed as paid by this function; payment must be completed separately.
create or replace function public.register_for_event(p_event_id uuid)
returns table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_member boolean;
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  if not found or v_event.status <> 'published' then raise exception 'Event is unavailable'; end if;
  if now() < v_event.registration_opens_at then raise exception 'Registration has not opened'; end if;
  if v_event.registration_closes_at is not null and now() >= v_event.registration_closes_at then raise exception 'Registration is closed'; end if;
  if v_event.members_only then
    select exists(select 1 from public.memberships m where m.user_id=v_user and m.status='active' and (m.ends_on is null or m.ends_on >= current_date)) into v_member;
    if not v_member then raise exception 'An active membership is required'; end if;
  end if;
  if exists(select 1 from public.registrations r where r.event_id=p_event_id and r.user_id=v_user and r.status <> 'cancelled') then raise exception 'You are already registered or waitlisted'; end if;
  select count(*) into v_count from public.registrations r where r.event_id=p_event_id and r.status='confirmed';
  if v_count < v_event.capacity then v_status := 'confirmed'; v_queue := null;
  else
    select coalesce(max(r.queue_position),0)+1 into v_queue from public.registrations r where r.event_id=p_event_id and r.status='waitlisted';
    v_status := 'waitlisted';
  end if;
  insert into public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
  values(p_event_id,v_user,v_status,v_queue,v_event.price_cents,case when v_event.price_cents=0 then 'not_required' else 'pending' end)
  returning id into v_id;
  return query select v_id,v_status,v_queue;
end;
$$;
revoke all on function public.register_for_event(uuid) from public;
grant execute on function public.register_for_event(uuid) to authenticated;


-- Explicit table privileges; row-level security remains the authorization boundary.
grant select on public.events to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select on public.registrations to authenticated;
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.waiver_versions to authenticated;
grant select on public.news, public.club_settings to anon, authenticated;
grant insert, update, delete on public.news, public.club_settings to authenticated;
grant usage on schema public to anon, authenticated;

-- Registration records must be created through register_for_event(), not direct client inserts.
revoke insert, update, delete on public.registrations from anon, authenticated;
grant select, insert, update, delete on public.registrations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('member-avatars', 'member-avatars', true, 3145728, array['image/jpeg','image/png','image/webp','image/gif']) on conflict (id) do nothing;
create policy "Members upload own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Members update own avatar" on storage.objects for update to authenticated using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Members delete own avatar" on storage.objects for delete to authenticated using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Private storage bucket for bylaws, policies, minutes, and member resources.
insert into storage.buckets (id, name, public)
values ('club-documents', 'club-documents', false)
on conflict (id) do nothing;

create policy "Members can read club documents" on storage.objects
for select to authenticated
using (bucket_id = 'club-documents');

create policy "Admins can upload club documents" on storage.objects
for insert to authenticated
with check (bucket_id = 'club-documents' and public.is_admin());

create policy "Admins can update club documents" on storage.objects
for update to authenticated
using (bucket_id = 'club-documents' and public.is_admin())
with check (bucket_id = 'club-documents' and public.is_admin());

create policy "Admins can delete club documents" on storage.objects
for delete to authenticated
using (bucket_id = 'club-documents' and public.is_admin());

-- PCTC profile fields: birthday display preference and required skill level for new signups.
-- Safe to apply to a project that already ran 0001_initial_schema.sql.
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists show_birthday_emoji boolean not null default false,
  add column if not exists tennis_skill_level text;

alter table public.profiles
  drop constraint if exists profiles_tennis_skill_level_check;
alter table public.profiles
  add constraint profiles_tennis_skill_level_check
  check (tennis_skill_level is null or tennis_skill_level in ('beginner','beginner_intermediate','intermediate','advanced','competitive'));

-- Require a valid skill level on all new auth signups. Existing profiles can fill it in later.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') not in ('beginner','beginner_intermediate','intermediate','advanced','competitive') then
    raise exception 'A valid tennis skill level is required to register.';
  end if;
  insert into public.profiles (id, email, full_name, tennis_skill_level)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''), new.raw_user_meta_data ->> 'tennis_skill_level');
  return new;
end;
$$;

-- Permit admins to edit their own profile without allowing members to promote themselves.
drop policy if exists "Members update own profile" on public.profiles;
create policy "Members update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and role = 'member')
  with check (id = (select auth.uid()) and role = 'member');

-- PCTC member ratings, required phone, avatars, club profile and public news.
alter table public.profiles add column if not exists avatar_url text;
-- New signups and profile edits require phone numbers; existing nullable rows remain valid until members update them.
alter table public.profiles drop constraint if exists profiles_tennis_skill_level_check;
update public.profiles set tennis_skill_level = case tennis_skill_level when 'beginner' then '2.5' when 'beginner_intermediate' then '3.0' when 'intermediate' then '3.5' when 'advanced' then '4.5' when 'competitive' then '5.5' else tennis_skill_level end
where tennis_skill_level in ('beginner','beginner_intermediate','intermediate','advanced','competitive');
alter table public.profiles add constraint profiles_tennis_skill_level_check
  check (tennis_skill_level is null or tennis_skill_level in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') not in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') then
    raise exception 'A valid tennis skill rating is required to register.';
  end if;
  if coalesce(trim(new.raw_user_meta_data ->> 'phone'), '') = '' then
    raise exception 'A phone number is required to register.';
  end if;
  insert into public.profiles (id, email, full_name, phone, tennis_skill_level)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''), trim(new.raw_user_meta_data ->> 'phone'), new.raw_user_meta_data ->> 'tennis_skill_level');
  return new;
end;
$$;

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.news enable row level security;
drop policy if exists "Public read published news" on public.news;
create policy "Public read published news" on public.news for select to anon, authenticated using (published or public.is_admin());
drop policy if exists "Admins manage news" on public.news;
create policy "Admins manage news" on public.news for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.news to anon, authenticated;
grant insert, update, delete on public.news to authenticated;

create table if not exists public.club_settings (
  id integer primary key default 1 check (id = 1),
  club_name text not null default 'Port Coquitlam Tennis Club',
  short_name text not null default 'PCTC',
  description text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  website_url text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.club_settings (id) values (1) on conflict (id) do nothing;
alter table public.club_settings enable row level security;
drop policy if exists "Public read club settings" on public.club_settings;
create policy "Public read club settings" on public.club_settings for select to anon, authenticated using (true);
drop policy if exists "Admins manage club settings" on public.club_settings;
create policy "Admins manage club settings" on public.club_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.club_settings to anon, authenticated;
grant insert, update, delete on public.club_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', true, 3145728, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];
drop policy if exists "Members upload own avatar" on storage.objects;
create policy "Members upload own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Members update own avatar" on storage.objects;
create policy "Members update own avatar" on storage.objects for update to authenticated
using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Members delete own avatar" on storage.objects;
create policy "Members delete own avatar" on storage.objects for delete to authenticated
using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.club_settings add column if not exists social_links jsonb not null default '[]'::jsonb;
alter table public.club_settings add column if not exists location_url text not null default '';

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

-- Member notes and suspension history. Apply after migrations 0001-0005.
create table if not exists public.member_admin_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  comment text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.member_admin_notes enable row level security;
drop policy if exists "Admins manage member admin notes" on public.member_admin_notes;
create policy "Admins manage member admin notes" on public.member_admin_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.member_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists member_suspensions_user_dates_idx on public.member_suspensions(user_id, starts_on, ends_on);
alter table public.member_suspensions enable row level security;
drop policy if exists "Admins manage member suspensions" on public.member_suspensions;
create policy "Admins manage member suspensions" on public.member_suspensions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Members read own suspensions" on public.member_suspensions;
create policy "Members read own suspensions" on public.member_suspensions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Names and positions are always visible. Contact details are shown when public, or
-- to a logged-in member with an active and paid membership.
create or replace function public.is_paid_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and (m.payment_status = 'paid' or exists (
        select 1 from public.payments p where p.membership_id = m.id and p.status in ('paid','recorded_manually')
      ))
      and (m.starts_on is null or m.starts_on <= current_date)
      and (m.ends_on is null or m.ends_on >= current_date)
  );
$$;
create or replace view public.public_club_contacts as
select cc.id, cc.position,
       case when cc.is_public or public.is_paid_member() then cc.emails else '{}'::text[] end as emails,
       case when cc.is_public or public.is_paid_member() then cc.phones else '{}'::text[] end as phones,
       cc.sort_order, p.full_name, p.avatar_url, cc.is_public
from public.club_contacts cc
join public.profiles p on p.id = cc.profile_id;
grant select on public.public_club_contacts to anon, authenticated;

-- Block new/updated event registrations for suspended members if the registration
-- is attempted during a suspension or the event falls within the suspension dates.
create or replace function public.reject_suspended_member_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_day date;
begin
  if new.status = 'cancelled' then return new; end if;
  select e.starts_at::date into event_day from public.events e where e.id = new.event_id;
  if exists (
    select 1 from public.member_suspensions s
    where s.user_id = new.user_id
      and (current_date between s.starts_on and s.ends_on
        or (event_day is not null and event_day between s.starts_on and s.ends_on))
  ) then
    raise exception 'Your account is suspended for this period and cannot register for club events.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_suspended_member_registration on public.registrations;
create trigger prevent_suspended_member_registration before insert or update of status, event_id, user_id
on public.registrations for each row execute function public.reject_suspended_member_registration();

-- Preserve suspension history when an administrator removes/cancels a suspension.
alter table public.member_suspensions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

create or replace function public.reject_suspended_member_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_day date;
begin
  if new.status = 'cancelled' then return new; end if;
  select e.starts_at::date into event_day from public.events e where e.id = new.event_id;
  if exists (
    select 1 from public.member_suspensions s
    where s.user_id = new.user_id and s.cancelled_at is null
      and (current_date between s.starts_on and s.ends_on
        or (event_day is not null and event_day between s.starts_on and s.ends_on))
  ) then
    raise exception 'Your account is suspended for this period and cannot register for club events.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Add the organizer role in a separate migration so the new enum value is committed
-- before policies and functions reference it in migration 0009.
ALTER TYPE public.club_role ADD VALUE IF NOT EXISTS 'organizer';

-- Full event scheduling, recurring sessions, waitlists, court assignments, and scores.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
UPDATE public.events SET event_type='ladder' WHERE event_type='program';
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (event_type IN ('social','ladder','tournament'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_id uuid;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT 'Port Coquitlam Tennis Club';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS court_count integer NOT NULL DEFAULT 4 CHECK (court_count BETWEEN 1 AND 4);

CREATE TABLE IF NOT EXISTS public.event_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  recurrence_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_on date NOT NULL,
  repeats_until date NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (repeats_until >= starts_on)
);
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event managers manage event series" ON public.event_series;
CREATE POLICY "Event managers manage event series" ON public.event_series FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='organizer'))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='organizer'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_series TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.role IN ('admin','organizer'));
$$;
DROP POLICY IF EXISTS "Admins manage events" ON public.events;
DROP POLICY IF EXISTS "Event managers manage events" ON public.events;
CREATE POLICY "Event managers manage events" ON public.events FOR ALL TO authenticated
 USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());

CREATE TABLE IF NOT EXISTS public.event_court_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  court_number integer NOT NULL CHECK (court_number BETWEEN 1 AND 4),
  segment_order integer NOT NULL DEFAULT 1 CHECK (segment_order BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(registration_id, court_number, segment_order)
);
CREATE INDEX IF NOT EXISTS event_court_assignments_event_idx ON public.event_court_assignments(event_id,court_number,segment_order);
ALTER TABLE public.event_court_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO anon, authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_court_assignments.event_id AND e.status='published'));
DROP POLICY IF EXISTS "Event managers manage court assignments" ON public.event_court_assignments;
CREATE POLICY "Event managers manage court assignments" ON public.event_court_assignments FOR ALL TO authenticated
 USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT ON public.event_court_assignments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_court_assignments TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_one_registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  player_two_registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  player_one_score integer NOT NULL CHECK (player_one_score >= 0),
  player_two_score integer NOT NULL CHECK (player_two_score >= 0),
  played_at timestamptz NOT NULL DEFAULT now(),
  entered_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_registration_id <> player_two_registration_id)
);
ALTER TABLE public.event_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO anon, authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.status='published'));
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
 WITH CHECK (
   entered_by=(SELECT auth.uid()) AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed') AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed') AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.event_id=event_scores.event_id)
 );
DROP POLICY IF EXISTS "Event managers manage scores" ON public.event_scores;
CREATE POLICY "Event managers manage scores" ON public.event_scores FOR ALL TO authenticated USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT, INSERT ON public.event_scores TO authenticated;
GRANT SELECT ON public.event_scores TO anon;

-- Read-only roster views deliberately expose names/avatars and event participation, not email or phone.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position, r.created_at AS registered_at,
       p.full_name, p.avatar_url
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted');
GRANT SELECT ON public.event_roster TO anon, authenticated;
DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id=s.event_id AND (e.status='published' OR public.is_event_manager()));
GRANT SELECT ON public.event_scoreboard TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_capacity integer; v_confirmed integer; v_next uuid; v_pos bigint;
BEGIN
 SELECT capacity INTO v_capacity FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO v_confirmed FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 WHILE v_confirmed < v_capacity LOOP
   SELECT r.id INTO v_next FROM public.registrations r JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND r.status='waitlisted' AND NOT EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=r.user_id AND (current_date BETWEEN s.starts_on AND s.ends_on OR e.starts_at::date BETWEEN s.starts_on AND s.ends_on)) ORDER BY r.queue_position NULLS LAST, r.created_at, r.id LIMIT 1 FOR UPDATE OF r;
   EXIT WHEN v_next IS NULL;
   UPDATE public.registrations SET status='confirmed', queue_position=NULL, updated_at=now() WHERE id=v_next;
   v_confirmed := v_confirmed + 1; v_next := NULL;
 END LOOP;
 WITH numbered AS (
   SELECT id, row_number() OVER (ORDER BY queue_position NULLS LAST, created_at, id) AS new_pos
   FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'
 ) UPDATE public.registrations r SET queue_position=n.new_pos, updated_at=now() FROM numbered n WHERE r.id=n.id;
END; $$;
REVOKE ALL ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.on_registration_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.promote_event_waitlist(OLD.event_id); RETURN OLD; END IF;
 IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN PERFORM public.promote_event_waitlist(OLD.event_id); END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS promote_waitlist_after_withdrawal ON public.registrations;
DROP TRIGGER IF EXISTS promote_waitlist_after_delete ON public.registrations;
CREATE TRIGGER promote_waitlist_after_withdrawal AFTER UPDATE OF status ON public.registrations
 FOR EACH ROW EXECUTE FUNCTION public.on_registration_withdrawal();
CREATE TRIGGER promote_waitlist_after_delete AFTER DELETE ON public.registrations
 FOR EACH ROW EXECUTE FUNCTION public.on_registration_withdrawal();

CREATE OR REPLACE FUNCTION public.withdraw_from_event(p_registration_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_registration public.registrations%rowtype; v_event public.events%rowtype;
BEGIN
 SELECT * INTO v_registration FROM public.registrations WHERE id=p_registration_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=v_registration.event_id;
 IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.'; END IF;
 IF v_registration.status='cancelled' THEN RETURN; END IF;
 UPDATE public.registrations SET status='cancelled', queue_position=NULL, updated_at=now() WHERE id=p_registration_id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_existing public.registrations%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
 IF p_action='remove' THEN
   SELECT * INTO v_existing FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled' FOR UPDATE;
   IF FOUND THEN UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=v_existing.id; END IF;
   RETURN;
 ELSIF p_action<>'add' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions WHERE user_id=p_user_id AND (current_date BETWEEN starts_on AND ends_on OR v_event.starts_at::date BETWEEN starts_on AND ends_on)) THEN RAISE EXCEPTION 'This member is suspended for the event date'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count < v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL;
 ELSE IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now()
 RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_member_directory()
RETURNS TABLE(id uuid, full_name text, avatar_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.avatar_url FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_member_directory() TO authenticated;

-- Keep the registration RPC secure and enforce cutoff, capacity, membership and suspension rules.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_event public.events%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid; v_member boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
 IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=v_user AND (current_date BETWEEN s.starts_on AND s.ends_on OR v_event.starts_at::date BETWEEN s.starts_on AND s.ends_on)) THEN RAISE EXCEPTION 'Your account is suspended for this period and cannot register for club events.'; END IF;
 IF v_event.members_only THEN
   SELECT EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=v_user AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date) AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')))) INTO v_member;
   IF NOT v_member THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=v_user AND status<>'cancelled') THEN RAISE EXCEPTION 'You are already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed';v_queue:=NULL;
 ELSE IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and the waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted';v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now()
 RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Do not allow organizers to manage news, members, club profile, memberships or payments.
-- Existing administrator-only policies remain in place for those areas.

-- Doubles score partners, participant ratings in event roster, and series-wide shared-field edits.
ALTER TABLE public.event_scores
  ADD COLUMN IF NOT EXISTS player_three_registration_id uuid REFERENCES public.registrations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS player_four_registration_id uuid REFERENCES public.registrations(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
WITH CHECK (
  entered_by=(SELECT auth.uid()) AND
  EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed' AND r.event_id=event_scores.event_id) AND
  EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed') AND
  (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')) AND
  (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')) AND
  (player_three_registration_id IS NULL OR player_three_registration_id <> player_one_registration_id) AND
  (player_four_registration_id IS NULL OR player_four_registration_id <> player_one_registration_id) AND
  (player_three_registration_id IS NULL OR player_three_registration_id <> player_two_registration_id) AND
  (player_four_registration_id IS NULL OR player_four_registration_id <> player_two_registration_id) AND
  (player_three_registration_id IS NULL OR player_four_registration_id IS NULL OR player_three_registration_id <> player_four_registration_id)
);

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id=r.user_id
JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted');
GRANT SELECT ON public.event_roster TO anon, authenticated;

DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id
JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id
JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id
LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id
LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id=s.event_id AND (e.status='published' OR public.is_event_manager()));
GRANT SELECT ON public.event_scoreboard TO anon, authenticated;

-- Court sub-sessions can extend beyond four; a court may repeat across sub-sessions.
ALTER TABLE public.event_court_assignments DROP CONSTRAINT IF EXISTS event_court_assignments_segment_order_check;
ALTER TABLE public.event_court_assignments ADD CONSTRAINT event_court_assignments_segment_order_check CHECK (segment_order >= 1);

-- Public club logo URL stored in Supabase Storage.
ALTER TABLE public.club_settings ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('club-assets','club-assets',true,5242880,ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880, allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'];
DROP POLICY IF EXISTS "Public read club assets" ON storage.objects;
CREATE POLICY "Public read club assets" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id='club-assets');
DROP POLICY IF EXISTS "Admins upload club assets" ON storage.objects;
CREATE POLICY "Admins upload club assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='club-assets' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update club assets" ON storage.objects;
CREATE POLICY "Admins update club assets" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='club-assets' AND public.is_admin()) WITH CHECK (bucket_id='club-assets' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete club assets" ON storage.objects;
CREATE POLICY "Admins delete club assets" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='club-assets' AND public.is_admin());

-- Expose only aggregate capacity information publicly; never expose participant names in public queries.
CREATE OR REPLACE VIEW public.event_public_counts AS
SELECT e.id AS event_id, count(r.id) FILTER (WHERE r.status='confirmed')::integer AS confirmed_count
FROM public.events e LEFT JOIN public.registrations r ON r.event_id=e.id
GROUP BY e.id;
GRANT SELECT ON public.event_public_counts TO anon, authenticated;

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id=r.user_id
JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager())
  AND r.status IN ('confirmed','waitlisted')
  AND (
    public.is_event_manager() OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
      AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
        AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;

DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO authenticated
USING (
 public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_court_assignments.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 )
);

DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO authenticated
USING (
 public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_scores.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 )
);
DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
 AND (public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 ));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

-- Tournament events must not accept scores, even through direct API calls.
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
WITH CHECK (
 entered_by=(SELECT auth.uid())
 AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.event_type<>'tournament')
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed' AND r.event_id=event_scores.event_id)
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')
 AND (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_three_registration_id IS NULL OR player_three_registration_id<>player_one_registration_id)
 AND (player_four_registration_id IS NULL OR player_four_registration_id<>player_one_registration_id)
 AND (player_three_registration_id IS NULL OR player_three_registration_id<>player_two_registration_id)
 AND (player_four_registration_id IS NULL OR player_four_registration_id<>player_two_registration_id)
 AND (player_three_registration_id IS NULL OR player_four_registration_id IS NULL OR player_three_registration_id<>player_four_registration_id)
);

-- New account applications require explicit administrator approval.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS application_status text NOT NULL DEFAULT 'pending' CHECK (application_status IN ('pending','approved','dismissed'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS application_comment text NOT NULL DEFAULT '';
-- Existing accounts keep their access; newly created profiles remain pending by default.
UPDATE public.profiles SET application_status='approved' WHERE created_at < now();

CREATE OR REPLACE FUNCTION public.prevent_self_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.id AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS prevent_self_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_self_role_change_trigger BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_change();
CREATE OR REPLACE FUNCTION public.prevent_self_application_status_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN IF (SELECT auth.uid())=OLD.id AND NEW.application_status IS DISTINCT FROM OLD.application_status THEN RAISE EXCEPTION 'Only administrators can process an application.'; END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS prevent_self_application_status_change_trigger ON public.profiles;
CREATE TRIGGER prevent_self_application_status_change_trigger BEFORE UPDATE OF application_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_self_application_status_change();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN RAISE EXCEPTION 'A valid tennis skill rating is required to register.'; END IF;
  IF coalesce(trim(new.raw_user_meta_data ->> 'phone'), '') = '' THEN RAISE EXCEPTION 'A phone number is required to register.'; END IF;
  INSERT INTO public.profiles (id,email,full_name,phone,tennis_skill_level,application_comment,application_status)
  VALUES (new.id,new.email,coalesce(new.raw_user_meta_data ->> 'full_name',''),trim(new.raw_user_meta_data ->> 'phone'),new.raw_user_meta_data ->> 'tennis_skill_level',coalesce(new.raw_user_meta_data ->> 'application_comment',''),'pending');
  RETURN new;
END; $$;

-- Registration must be blocked for unapproved applications and only evaluate the suspension against the event date.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_event public.events%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid; v_member boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.application_status='approved') THEN RAISE EXCEPTION 'Your registration is pending administrator approval.'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
 IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN RAISE EXCEPTION 'Registration is unavailable for events that have already started'; END IF;
 IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.'; END IF;
 IF v_event.members_only THEN
   SELECT EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=v_user AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date) AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')))) INTO v_member;
   IF NOT v_member THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.registrations r WHERE r.event_id=p_event_id AND r.user_id=v_user AND r.status<>'cancelled') THEN RAISE EXCEPTION 'You are already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL; ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(r.queue_position),0)+1 INTO v_queue FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status) VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Event managers adding members must also respect the event date (not the current date).
CREATE OR REPLACE FUNCTION public.block_scores_after_two_days()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_start timestamptz; v_type text;
BEGIN
 SELECT starts_at,event_type INTO v_start,v_type FROM public.events WHERE id=NEW.event_id;
 IF v_type='tournament' THEN RAISE EXCEPTION 'Scores are not available for tournament events.'; END IF;
 IF v_start < now() - interval '2 days' THEN RAISE EXCEPTION 'Scores can only be entered within two days of the event.'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS block_old_event_scores ON public.event_scores;
CREATE TRIGGER block_old_event_scores BEFORE INSERT OR UPDATE ON public.event_scores FOR EACH ROW EXECUTE FUNCTION public.block_scores_after_two_days();

-- Make the public scoreboard unavailable to unauthenticated visitors and require a paid member's own registration.
REVOKE SELECT ON public.event_scoreboard FROM anon;


-- Admin-assisted registration and waitlist promotion should evaluate suspension against the event date only.
CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_existing public.registrations%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
 IF p_action='remove' THEN
   SELECT * INTO v_existing FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled' FOR UPDATE;
   IF FOUND THEN UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=v_existing.id; END IF;
   RETURN;
 ELSIF p_action<>'add' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p_user_id AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN RAISE EXCEPTION 'This member is suspended for the event date'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL; ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status) VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now() RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_capacity integer; v_confirmed integer; v_next uuid;
BEGIN
 SELECT capacity INTO v_capacity FROM public.events WHERE id=p_event_id FOR UPDATE; IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO v_confirmed FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 WHILE v_confirmed<v_capacity LOOP
  SELECT r.id INTO v_next FROM public.registrations r JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND r.status='waitlisted' AND NOT EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=r.user_id AND (e.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) ORDER BY r.queue_position NULLS LAST,r.created_at,r.id LIMIT 1 FOR UPDATE OF r;
  EXIT WHEN v_next IS NULL;
  UPDATE public.registrations SET status='confirmed',queue_position=NULL,updated_at=now() WHERE id=v_next; v_confirmed:=v_confirmed+1; v_next:=NULL;
 END LOOP;
 WITH numbered AS (SELECT id,row_number() OVER(ORDER BY queue_position NULLS LAST,created_at,id) AS new_pos FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted') UPDATE public.registrations r SET queue_position=n.new_pos,updated_at=now() FROM numbered n WHERE r.id=n.id;
END; $$;
REVOKE ALL ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id,r.event_id,r.user_id,r.status,r.queue_position,r.created_at AS registered_at,p.full_name,p.avatar_url,p.tennis_skill_level
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted')
AND (public.is_event_manager() OR ((SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
 AND EXISTS(SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
  AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))));
GRANT SELECT ON public.event_roster TO anon,authenticated;

DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name
FROM public.event_scores s JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
AND (public.is_event_manager() OR ((SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
 AND EXISTS(SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
  AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

DROP POLICY IF EXISTS "Published events visible" ON public.events;
CREATE POLICY "Public published and cancelled events visible" ON public.events FOR SELECT TO anon,authenticated
USING (status IN ('published','cancelled') OR public.is_event_manager());
CREATE OR REPLACE VIEW public.event_public_counts AS
SELECT e.id AS event_id,count(r.id) FILTER (WHERE r.status='confirmed')::integer AS confirmed_count
FROM public.events e LEFT JOIN public.registrations r ON r.event_id=e.id
WHERE e.status IN ('published','cancelled') OR public.is_event_manager()
GROUP BY e.id;
GRANT SELECT ON public.event_public_counts TO anon,authenticated;


CREATE OR REPLACE FUNCTION public.withdraw_from_event(p_registration_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_registration public.registrations%rowtype; v_event public.events%rowtype;
BEGIN
 SELECT * INTO v_registration FROM public.registrations WHERE id=p_registration_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=v_registration.event_id;
 IF v_event.status='cancelled' THEN RAISE EXCEPTION 'Attendance cannot be changed for a cancelled event.'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.'; END IF;
 IF v_registration.status='cancelled' THEN RETURN; END IF;
 UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=p_registration_id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid) TO authenticated;

-- Durable queue for event email notifications. Delivery is handled server-side through Resend.
CREATE TABLE IF NOT EXISTS public.event_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('registration_created','registration_cancelled','event_cancelled','waitlist_confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS event_notification_queue_pending_idx ON public.event_notification_queue(created_at) WHERE sent_at IS NULL;
ALTER TABLE public.event_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_notification_queue FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_registration_email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('confirmed','waitlisted') THEN
    INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
    VALUES(NEW.event_id,NEW.user_id,'registration_created');
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'cancelled' AND NEW.status IN ('confirmed','waitlisted') THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'registration_created');
    ELSIF OLD.status IN ('confirmed','waitlisted') AND NEW.status = 'cancelled' THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'registration_cancelled');
    ELSIF OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'waitlist_confirmed');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_registration_email_notification ON public.registrations;
CREATE TRIGGER queue_registration_email_notification
AFTER INSERT OR UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.queue_registration_email_notification();

CREATE OR REPLACE FUNCTION public.queue_event_cancelled_email_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status='cancelled' THEN
    INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
    SELECT NEW.id,r.user_id,'event_cancelled'
    FROM public.registrations r
    WHERE r.event_id=NEW.id AND r.status IN ('confirmed','waitlisted');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_event_cancelled_email_notifications ON public.events;
CREATE TRIGGER queue_event_cancelled_email_notifications
AFTER UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION public.queue_event_cancelled_email_notifications();

REVOKE ALL ON FUNCTION public.queue_registration_email_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_event_cancelled_email_notifications() FROM PUBLIC, anon, authenticated;

-- Player attributes, event gender restrictions, email preferences and court-assignment replacement support.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS playing_hand text CHECK (playing_hand IN ('left','right'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_registration_updates boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_waitlist_updates boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_event_cancellations boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_registration_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_new_events boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_newsletter boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gender_restriction text CHECK (gender_restriction IN ('male','female'));

-- Court assignments can be transferred, along with score references, when replacing a roster member.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_reg uuid; new_reg uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
 SELECT id INTO old_reg FROM public.registrations WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted') LIMIT 1 FOR UPDATE;
 SELECT id INTO new_reg FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id AND status IN ('confirmed','waitlisted') LIMIT 1 FOR UPDATE;
 IF old_reg IS NULL OR new_reg IS NULL THEN RAISE EXCEPTION 'Both participants must be registered for this event.'; END IF;
 -- A score cannot list the same registration twice; preserve every transferable score and discard only impossible duplicate-player matches.
 DELETE FROM public.event_scores s WHERE s.event_id=p_event_id
 AND (s.player_one_registration_id=old_reg OR s.player_two_registration_id=old_reg OR s.player_three_registration_id=old_reg OR s.player_four_registration_id=old_reg)
 AND (s.player_one_registration_id=new_reg OR s.player_two_registration_id=new_reg OR s.player_three_registration_id=new_reg OR s.player_four_registration_id=new_reg);
 UPDATE public.event_court_assignments SET registration_id=new_reg WHERE event_id=p_event_id AND registration_id=old_reg
   AND NOT EXISTS (SELECT 1 FROM public.event_court_assignments x WHERE x.event_id=p_event_id AND x.registration_id=new_reg AND x.court_number=event_court_assignments.court_number AND x.segment_order=event_court_assignments.segment_order);
 UPDATE public.event_scores SET player_one_registration_id=new_reg WHERE event_id=p_event_id AND player_one_registration_id=old_reg;
 UPDATE public.event_scores SET player_two_registration_id=new_reg WHERE event_id=p_event_id AND player_two_registration_id=old_reg;
 UPDATE public.event_scores SET player_three_registration_id=new_reg WHERE event_id=p_event_id AND player_three_registration_id=old_reg;
 UPDATE public.event_scores SET player_four_registration_id=new_reg WHERE event_id=p_event_id AND player_four_registration_id=old_reg;
 DELETE FROM public.event_court_assignments WHERE event_id=p_event_id AND registration_id=old_reg;
 DELETE FROM public.event_scores WHERE event_id=p_event_id AND (player_one_registration_id=player_two_registration_id OR player_one_registration_id=player_three_registration_id OR player_one_registration_id=player_four_registration_id OR player_two_registration_id=player_three_registration_id OR player_two_registration_id=player_four_registration_id OR player_three_registration_id=player_four_registration_id);
 UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=old_reg;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_email_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 email_type text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id,email_type)
);
ALTER TABLE public.event_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_email_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_event_gender_restriction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_gender text; profile_gender text;
BEGIN
 SELECT gender_restriction INTO event_gender FROM public.events WHERE id=NEW.event_id;
 IF event_gender IS NOT NULL THEN
   SELECT gender INTO profile_gender FROM public.profiles WHERE id=NEW.user_id;
   IF profile_gender IS DISTINCT FROM event_gender THEN RAISE EXCEPTION 'This event is restricted to % participants. Update your profile gender to register if applicable.', event_gender; END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_event_gender_restriction ON public.registrations;
CREATE TRIGGER enforce_event_gender_restriction BEFORE INSERT OR UPDATE OF user_id,event_id ON public.registrations
 FOR EACH ROW WHEN (NEW.status IN ('confirmed','waitlisted')) EXECUTE FUNCTION public.enforce_event_gender_restriction();
REVOKE ALL ON FUNCTION public.enforce_event_gender_restriction() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.event_notification_queue DROP CONSTRAINT IF EXISTS event_notification_queue_notification_type_check;
ALTER TABLE public.event_notification_queue ADD CONSTRAINT event_notification_queue_notification_type_check CHECK (notification_type IN ('registration_created','registration_cancelled','event_cancelled','waitlist_confirmed','new_event_created'));
CREATE OR REPLACE FUNCTION public.queue_new_event_email_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
  SELECT NEW.id,p.id,'new_event_created' FROM public.profiles p
  WHERE p.application_status='approved' AND p.email_new_events=true AND p.id IS DISTINCT FROM NEW.created_by;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_new_event_email_notifications ON public.events;
CREATE TRIGGER queue_new_event_email_notifications AFTER INSERT OR UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION public.queue_new_event_email_notifications();
REVOKE ALL ON FUNCTION public.queue_new_event_email_notifications() FROM PUBLIC, anon, authenticated;

-- Event types are hidden in the UI for now; new events retain the legacy column using a neutral default.
ALTER TABLE public.events ALTER COLUMN event_type SET DEFAULT 'social';

-- Member-only PDF library with admin uploads.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'application/pdf';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_size_bytes bigint;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.is_active_member(v_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.memberships m
   WHERE m.user_id = v_user AND m.status = 'active'
     AND (m.starts_on IS NULL OR m.starts_on <= current_date)
     AND (m.ends_on IS NULL OR m.ends_on >= current_date)
 )
$$;
REVOKE ALL ON FUNCTION public.is_active_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "Members read permitted documents" ON public.documents;
DROP POLICY IF EXISTS "Active members read documents" ON public.documents;
CREATE POLICY "Active members read documents" ON public.documents FOR SELECT TO authenticated
 USING (public.is_active_member() OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage documents" ON public.documents;
CREATE POLICY "Admins manage documents" ON public.documents FOR ALL TO authenticated
 USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.documents TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.documents TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-documents', 'member-documents', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520, allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "Admins upload member PDFs" ON storage.objects;
CREATE POLICY "Admins upload member PDFs" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update member PDFs" ON storage.objects;
CREATE POLICY "Admins update member PDFs" ON storage.objects FOR UPDATE TO authenticated
 USING (bucket_id = 'member-documents' AND public.is_admin())
 WITH CHECK (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete member PDFs" ON storage.objects;
CREATE POLICY "Admins delete member PDFs" ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Active members download PDFs" ON storage.objects;
CREATE POLICY "Active members download PDFs" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id = 'member-documents' AND (public.is_active_member() OR public.is_admin()));

CREATE TABLE IF NOT EXISTS public.email_announcement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body_html text NOT NULL,
  recipient_group text NOT NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_announcement_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_announcement_history FROM PUBLIC, anon, authenticated;

-- Versioned legal documents managed by administrators.
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('membership_waiver','terms_of_use','disclaimer')),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  body_html text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_document_one_current_version
  ON public.legal_document_versions(document_type) WHERE is_current = true;
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read current legal documents" ON public.legal_document_versions;
CREATE POLICY "Public read current legal documents" ON public.legal_document_versions
  FOR SELECT TO anon, authenticated USING (is_current = true OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage legal documents" ON public.legal_document_versions;
CREATE POLICY "Admins manage legal documents" ON public.legal_document_versions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.legal_document_versions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.legal_document_versions TO authenticated;

INSERT INTO public.legal_document_versions (document_type, version, title, body_html, is_current)
VALUES
 ('membership_waiver', 1, 'Membership Waiver', '<h2>Membership Waiver — Placeholder</h2><p>This is placeholder text only and is not a legally reviewed waiver. Replace it with wording reviewed by a qualified British Columbia lawyer before collecting signatures or relying on it.</p>', true),
 ('terms_of_use', 1, 'Site Terms of Use', '<h2>Terms of Use — Placeholder</h2><p>This is placeholder text for the PCTC website terms of use. It has not been reviewed by a lawyer and should be replaced before launch.</p>', true),
 ('disclaimer', 1, 'Disclaimer', '<h2>Disclaimer — Placeholder</h2><p>This is placeholder text for the PCTC website disclaimer. It has not been reviewed by a lawyer and should be replaced before launch.</p>', true)
ON CONFLICT (document_type, version) DO NOTHING;

-- Documents are available to approved members who have paid a membership fee at least once,
-- even if their membership has since expired. An approved but never-paid applicant is excluded.
CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.memberships m ON m.user_id = pr.id
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.membership_id = m.id AND p.status IN ('paid', 'recorded_manually')
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

DROP POLICY IF EXISTS "Active members read documents" ON public.documents;
CREATE POLICY "Paid members read documents" ON public.documents FOR SELECT TO authenticated
  USING (public.has_ever_paid_membership() OR public.is_admin());
DROP POLICY IF EXISTS "Active members download PDFs" ON storage.objects;
CREATE POLICY "Paid members download PDFs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'member-documents' AND (public.has_ever_paid_membership() OR public.is_admin()));

-- Enable cross-session court-assignment updates where Supabase Realtime is available.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_court_assignments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- PCTC photo gallery: private storage with visibility enforced by RLS.
CREATE TABLE IF NOT EXISTS public.gallery_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK (length(trim(title)) > 0),
 description text NOT NULL DEFAULT '',
 visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members')),
 is_published boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.gallery_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES public.gallery_albums(id) ON DELETE CASCADE,
 storage_path text NOT NULL UNIQUE,
 caption text NOT NULL DEFAULT '',
 alt_text text NOT NULL DEFAULT '',
 sort_order integer NOT NULL DEFAULT 0,
 uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gallery_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Gallery albums readable by permitted viewers" ON public.gallery_albums;
CREATE POLICY "Gallery albums readable by permitted viewers" ON public.gallery_albums FOR SELECT TO anon, authenticated USING (
 is_published AND (visibility = 'public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved')))))
 OR public.is_admin()
);
DROP POLICY IF EXISTS "Admins manage gallery albums" ON public.gallery_albums;
CREATE POLICY "Admins manage gallery albums" ON public.gallery_albums FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Gallery photos readable by permitted viewers" ON public.gallery_photos;
CREATE POLICY "Gallery photos readable by permitted viewers" ON public.gallery_photos FOR SELECT TO anon, authenticated USING (
 EXISTS (SELECT 1 FROM public.gallery_albums a WHERE a.id=album_id AND a.is_published AND (a.visibility='public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'))))))
 OR public.is_admin()
);
DROP POLICY IF EXISTS "Admins manage gallery photos" ON public.gallery_photos;
CREATE POLICY "Admins manage gallery photos" ON public.gallery_photos FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.gallery_albums, public.gallery_photos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.gallery_albums, public.gallery_photos TO authenticated;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('gallery-photos','gallery-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
DROP POLICY IF EXISTS "Admins upload gallery photos" ON storage.objects;
CREATE POLICY "Admins upload gallery photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update gallery photos storage" ON storage.objects;
CREATE POLICY "Admins update gallery photos storage" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='gallery-photos' AND public.is_admin()) WITH CHECK (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete gallery photos storage" ON storage.objects;
CREATE POLICY "Admins delete gallery photos storage" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Permitted viewers read gallery photos storage" ON storage.objects;
CREATE POLICY "Permitted viewers read gallery photos storage" ON storage.objects FOR SELECT TO anon, authenticated USING (
 bucket_id='gallery-photos' AND EXISTS (
  SELECT 1 FROM public.gallery_photos gp JOIN public.gallery_albums ga ON ga.id=gp.album_id
  WHERE gp.storage_path=name AND ga.is_published AND (ga.visibility='public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved')))))
 )
);

create table if not exists public.membership_plan_settings (
 id integer primary key default 1 check (id=1),
 single_price_cents integer not null default 0 check(single_price_cents>=0),
 family_price_cents integer not null default 0 check(family_price_cents>=0),
 family_max_adults integer not null default 2 check(family_max_adults between 1 and 10),
 family_max_children integer not null default 4 check(family_max_children between 0 and 20),
 season_start_month integer not null default 4 check(season_start_month between 1 and 12),
 season_start_day integer not null default 1 check(season_start_day between 1 and 31),
 season_end_month integer not null default 9 check(season_end_month between 1 and 12),
 season_end_day integer not null default 30 check(season_end_day between 1 and 31),
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
insert into public.membership_plan_settings(id) values(1) on conflict(id) do nothing;
create table if not exists public.membership_families (
 id uuid primary key default gen_random_uuid(),
 season_year integer not null,
 paid_at timestamptz,
 paid_by uuid references public.profiles(id),
 payment_id uuid references public.payments(id),
 created_at timestamptz not null default now()
);
create table if not exists public.membership_family_members (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.membership_families(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 invited_by uuid references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','confirmed','declined','removed_next_season')),
 joined_at timestamptz,
 created_at timestamptz not null default now(),
 unique(family_id,user_id)
);
create index if not exists membership_family_members_user_idx on public.membership_family_members(user_id,status);
create table if not exists public.membership_reminder_log (
 id uuid primary key default gen_random_uuid(), season_year integer not null, reminder_type text not null check(reminder_type in ('before','after')),
 user_id uuid not null references public.profiles(id) on delete cascade, sent_at timestamptz not null default now(), unique(season_year,reminder_type,user_id)
);
alter table public.membership_plan_settings enable row level security;
alter table public.membership_families enable row level security;
alter table public.membership_family_members enable row level security;
alter table public.membership_reminder_log enable row level security;
create policy "Approved users read membership plan settings" on public.membership_plan_settings for select to authenticated using(true);
create policy "Admins manage membership plan settings" on public.membership_plan_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "Users read their family groups" on public.membership_families for select to authenticated using(exists(select 1 from public.membership_family_members fm where fm.family_id=id and fm.user_id=auth.uid()));
create policy "Users read family member rows" on public.membership_family_members for select to authenticated using(user_id=auth.uid() or invited_by=auth.uid() or public.is_admin());
create policy "Admins manage families" on public.membership_families for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "Admins manage family members" on public.membership_family_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select on public.membership_plan_settings to authenticated;
grant select on public.membership_families,public.membership_family_members to authenticated;

-- Preserve successful waitlist promotions so attendance statistics can distinguish
-- people initially confirmed from people later promoted into an available place.
CREATE TABLE IF NOT EXISTS public.event_waitlist_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  promoted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_waitlist_promotions_event_idx ON public.event_waitlist_promotions(event_id);
ALTER TABLE public.event_waitlist_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event managers can view waitlist promotion history" ON public.event_waitlist_promotions;
CREATE POLICY "Event managers can view waitlist promotion history" ON public.event_waitlist_promotions
  FOR SELECT TO authenticated USING (public.is_event_manager());
REVOKE INSERT, UPDATE, DELETE ON public.event_waitlist_promotions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_event_waitlist_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN
    INSERT INTO public.event_waitlist_promotions(registration_id,event_id,user_id,promoted_at)
    VALUES(NEW.id,NEW.event_id,NEW.user_id,coalesce(NEW.updated_at,now()));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS track_event_waitlist_promotion ON public.registrations;
CREATE TRIGGER track_event_waitlist_promotion
AFTER UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.track_event_waitlist_promotion();

-- Expose the score author to the authenticated event page so players can edit scores they entered.
DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name,s.entered_by
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
AND (public.is_event_manager() OR ((SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
 AND EXISTS(SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
  AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

DROP POLICY IF EXISTS "Participants edit their recent scores" ON public.event_scores;
CREATE POLICY "Participants edit their recent scores" ON public.event_scores FOR UPDATE TO authenticated
USING (
 entered_by=(SELECT auth.uid())
 AND EXISTS(SELECT 1 FROM public.registrations r WHERE r.id=event_scores.player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.event_id=event_scores.event_id)
 AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.starts_at >= now()-interval '2 days')
)
WITH CHECK (
 entered_by=(SELECT auth.uid())
 AND EXISTS(SELECT 1 FROM public.registrations r WHERE r.id=event_scores.player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.event_id=event_scores.event_id)
 AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.starts_at >= now()-interval '2 days')
);

-- Event managers need contact details to coordinate participants. The function remains
-- restricted to approved event managers; it is not granted to anon/PUBLIC.
DROP FUNCTION IF EXISTS public.event_member_directory();
CREATE FUNCTION public.event_member_directory()
RETURNS TABLE(id uuid, full_name text, avatar_url text, email text, phone text, tennis_skill_level text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text
 FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_member_directory() TO authenticated;

-- Fix participant replacement: the UI selects an approved member who is not yet on the event roster.
-- Transfer the existing registration row so court assignments and score references remain attached.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
  v_old_status public.registration_status;
BEGIN
  IF NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Only event managers can replace participants.';
  END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN
    RAISE EXCEPTION 'Choose two different members.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id, status INTO old_reg, v_old_status
    FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed','waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id=p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'The replacement must be an approved member.';
  END IF;
  IF v_event.members_only AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id=p_new_user_id AND m.status='active'
      AND (m.ends_on IS NULL OR m.ends_on >= current_date)
      AND (m.payment_status='paid' OR EXISTS (
        SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')
      ))
  ) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  -- Reusing the registration row preserves court assignments, queue position and score references.
  UPDATE public.registrations SET user_id=p_new_user_id, updated_at=now() WHERE id=old_reg;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

-- Keep event eligibility consistent with the Membership dashboard: a paid family plan
-- covers each confirmed family member, even if that member's individual membership row
-- is marked unpaid. A member scheduled to leave next season remains covered this season.
CREATE OR REPLACE FUNCTION public.has_active_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user
        AND m.status = 'active'
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
        AND (
          m.payment_status = 'paid'
          OR EXISTS (
            SELECT 1 FROM public.payments p
            WHERE p.membership_id = m.id
              AND p.status IN ('paid', 'recorded_manually')
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = v_user
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_paid_membership(uuid) TO authenticated;

-- Registration now recognises a paid family membership as well as a paid individual plan.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.application_status='approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_suspensions s
    WHERE s.user_id=v_user
      AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on
      AND s.cancelled_at IS NULL
  ) THEN RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An active, paid membership is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id=p_event_id AND r.user_id=v_user AND r.status<>'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='confirmed';
  IF v_count<v_event.capacity THEN
    v_status:='confirmed'; v_queue:=NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position),0)+1 INTO v_queue FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='waitlisted';
    v_status:='waitlisted';
  END IF;
  INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
  VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Participant replacement uses the same membership entitlement rule as self-registration.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id INTO old_reg FROM public.registrations
    WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id=p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  UPDATE public.registrations SET user_id=p_new_user_id, updated_at=now() WHERE id=old_reg;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

-- Family members who are registered may read the same roster, court assignments and scores as individually paid members.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id,r.event_id,r.user_id,r.status,r.queue_position,r.created_at AS registered_at,p.full_name,p.avatar_url,p.tennis_skill_level
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager())
  AND r.status IN ('confirmed','waitlisted')
  AND (public.is_event_manager() OR (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
    AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  ));
GRANT SELECT ON public.event_roster TO anon,authenticated;

DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
  AND (public.is_event_manager() OR (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
    AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  ));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

-- The same family entitlement must allow registered family members to read court assignments and scores.
DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO authenticated
USING (
  public.is_event_manager() OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_court_assignments.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  )
);
DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO authenticated
USING (
  public.is_event_manager() OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_scores.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  )
);

-- A member may register again after withdrawing. Keep historical cancelled rows so
-- old score/payment references remain intact, but enforce uniqueness only for active
-- registrations (confirmed or waitlisted).
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_event_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_id_user_id_active_key
  ON public.registrations (event_id, user_id)
  WHERE status <> 'cancelled';

-- Admin add/remove must also create a new registration after a prior withdrawal,
-- rather than trying to upsert against the old unconditional unique constraint.
CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_existing public.registrations%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  IF p_action = 'remove' THEN
    SELECT * INTO v_existing
    FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
    ORDER BY created_at DESC
    LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.registrations
      SET status = 'cancelled', queue_position = NULL, updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN;
  ELSIF p_action <> 'add' THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Member is already registered or waitlisted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.member_suspensions
    WHERE user_id = p_user_id
      AND (current_date BETWEEN starts_on AND ends_on OR v_event.starts_at::date BETWEEN starts_on AND ends_on)
  ) THEN
    RAISE EXCEPTION 'This member is suspended for the event date';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.registrations
  WHERE event_id = p_event_id AND status = 'confirmed';

  IF v_count < v_event.capacity THEN
    v_status := 'confirmed';
    v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(queue_position), 0) + 1 INTO v_queue
    FROM public.registrations
    WHERE event_id = p_event_id AND status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;

  INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
  VALUES (
    p_event_id, p_user_id, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_event_registration(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid, uuid, text) TO authenticated;

-- Canonical event URLs use <title-slug>-<YYYY-MM-DD>-<HH-mm> in America/Vancouver.
-- If that base URL is already in use, append -2, -3, ... to keep every URL unique.

create table if not exists public.event_slug_aliases (
  slug text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.event_slug_aliases enable row level security;
drop policy if exists "Event slug aliases are readable" on public.event_slug_aliases;
create policy "Event slug aliases are readable"
  on public.event_slug_aliases for select to anon, authenticated using (true);

create or replace function public.event_slug_base(p_title text, p_starts_at timestamptz)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  title_part text;
begin
  title_part := trim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'));
  title_part := trim(both '-' from left(title_part, 100));
  if title_part = '' then title_part := 'event'; end if;
  return title_part || '-' || to_char(p_starts_at at time zone 'America/Vancouver', 'YYYY-MM-DD-HH24-MI');
end;
$$;

create or replace function public.set_event_readable_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  if tg_op = 'INSERT'
     or new.slug is null
     or new.title is distinct from old.title
     or new.starts_at is distinct from old.starts_at then
    base_slug := public.event_slug_base(new.title, new.starts_at);

    -- Serialize concurrent attempts for the same base slug; the unique index below
    -- remains the final database-level guarantee.
    perform pg_advisory_xact_lock(hashtext(base_slug));
    candidate := base_slug;

    while exists (
      select 1 from public.events e
      where e.slug = candidate and e.id is distinct from new.id
    ) or exists (
      select 1 from public.event_slug_aliases a
      where a.slug = candidate and a.event_id is distinct from new.id
    ) loop
      suffix := suffix + 1;
      candidate := base_slug || '-' || suffix::text;
    end loop;

    if tg_op = 'UPDATE' and old.slug is not null and old.slug <> candidate then
      insert into public.event_slug_aliases(slug, event_id)
      values (old.slug, old.id)
      on conflict (slug) do nothing;
    end if;

    new.slug := candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists set_event_readable_slug on public.events;
create trigger set_event_readable_slug
  before insert or update on public.events
  for each row execute function public.set_event_readable_slug();

-- Backfill existing events through the same collision-safe slug generator.
update public.events set slug = null;

-- Explicit unique index documenting and enforcing uniqueness for generated slugs.
create unique index if not exists events_slug_unique_idx
  on public.events(slug) where slug is not null;

-- Event managers can see event-date suspension status and explicitly override it
-- when manually adding/replacing a player. Self-service registration remains blocked.
DROP FUNCTION IF EXISTS public.event_member_directory();
CREATE FUNCTION public.event_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, avatar_url text, email text, phone text, tennis_skill_level text, suspended boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_day date;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO v_event_day FROM public.events e WHERE e.id=p_event_id;
 IF v_event_day IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
 RETURN QUERY
 SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text,
   EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p.id AND s.cancelled_at IS NULL AND v_event_day BETWEEN s.starts_on AND s.ends_on) AS suspended
 FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_member_directory(uuid) TO authenticated;

-- The trigger blocks suspended members from self-service registration, but allows
-- explicit event-manager operations. The UI asks for confirmation before those actions.
CREATE OR REPLACE FUNCTION public.reject_suspended_member_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_day date;
BEGIN
 IF new.status='cancelled' THEN RETURN new; END IF;
 IF current_setting('app.event_manager_override_suspension', true) = 'on' THEN RETURN new; END IF;
 SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO event_day FROM public.events e WHERE e.id=new.event_id;
 IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=new.user_id AND s.cancelled_at IS NULL
   AND (current_date BETWEEN s.starts_on AND s.ends_on OR (event_day IS NOT NULL AND event_day BETWEEN s.starts_on AND s.ends_on))) THEN
   RAISE EXCEPTION 'Your account is suspended for this period and cannot register for club events.' USING errcode='42501';
 END IF;
 RETURN new;
END; $$;

CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_existing public.registrations%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 PERFORM set_config('app.event_manager_override_suspension','on',true);
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
 IF p_action='remove' THEN
   SELECT * INTO v_existing FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND THEN UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=v_existing.id; END IF;
   RETURN;
 ELSIF p_action<>'add' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.application_status='approved') THEN RAISE EXCEPTION 'Member must have an approved account'; END IF;
 IF v_event.members_only AND NOT public.has_active_paid_membership(p_user_id) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL;
 ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

-- Replacing a confirmed player with a waitlisted player promotes that waitlisted
-- registration directly, regardless of queue position, and transfers court/score links.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; old_row public.registrations%rowtype; new_row public.registrations%rowtype; v_count integer;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
 PERFORM set_config('app.event_manager_override_suspension','on',true);
 IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id=p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
 SELECT * INTO old_row FROM public.registrations WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF old_row.id IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
 SELECT * INTO new_row FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id AND status IN ('confirmed','waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF new_row.id IS NOT NULL AND new_row.status<>'waitlisted' THEN RAISE EXCEPTION 'The selected member is already confirmed for this event.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_new_user_id AND p.application_status='approved') THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
 IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.'; END IF;
 IF old_row.status='confirmed' AND new_row.status='waitlisted' THEN
   UPDATE public.event_court_assignments SET registration_id=new_row.id WHERE registration_id=old_row.id;
   UPDATE public.event_scores SET player_one_registration_id=new_row.id WHERE player_one_registration_id=old_row.id;
   UPDATE public.event_scores SET player_two_registration_id=new_row.id WHERE player_two_registration_id=old_row.id;
   UPDATE public.event_scores SET player_three_registration_id=new_row.id WHERE player_three_registration_id=old_row.id;
   UPDATE public.event_scores SET player_four_registration_id=new_row.id WHERE player_four_registration_id=old_row.id;
   UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=old_row.id;
   UPDATE public.registrations SET status='confirmed',queue_position=NULL,updated_at=now() WHERE id=new_row.id;
   WITH ranked AS (SELECT id,row_number() OVER(ORDER BY queue_position NULLS LAST,created_at,id) AS new_position FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted')
   UPDATE public.registrations r SET queue_position=ranked.new_position,updated_at=now() FROM ranked WHERE r.id=ranked.id;
 ELSIF new_row.id IS NULL THEN
   UPDATE public.registrations SET user_id=p_new_user_id,updated_at=now() WHERE id=old_row.id;
 ELSE
   RAISE EXCEPTION 'The selected member cannot replace this player.';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

-- Prevent score entry before the event session starts, including writes made outside the UI.
CREATE OR REPLACE FUNCTION public.block_scores_after_two_days()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_start timestamptz;
  v_type text;
BEGIN
  SELECT starts_at, event_type
    INTO v_start, v_type
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_type = 'tournament' THEN
    RAISE EXCEPTION 'Scores are not available for tournament events.';
  END IF;

  IF TG_OP = 'INSERT' AND v_start > now() THEN
    RAISE EXCEPTION 'Scores cannot be entered before the session start time.';
  END IF;

  IF v_start < now() - interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_old_event_scores ON public.event_scores;
CREATE TRIGGER block_old_event_scores
BEFORE INSERT OR UPDATE ON public.event_scores
FOR EACH ROW EXECUTE FUNCTION public.block_scores_after_two_days();
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','failure','denied','info')),
  target_table text,
  target_record_id text,
  event_id uuid,
  route text,
  source text NOT NULL DEFAULT 'database',
  summary text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text
);
CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON public.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_event_idx ON public.audit_logs (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_table, target_record_id);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

CREATE TABLE IF NOT EXISTS public.application_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','critical')),
  source text NOT NULL DEFAULT 'server',
  error_type text NOT NULL DEFAULT 'ApplicationError',
  message text NOT NULL,
  route text,
  operation text,
  event_id uuid,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS application_errors_occurred_at_idx ON public.application_errors (occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_errors_severity_idx ON public.application_errors (severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_errors_route_idx ON public.application_errors (route);
ALTER TABLE public.application_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read application errors" ON public.application_errors;
CREATE POLICY "Admins read application errors" ON public.application_errors FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.application_errors FROM anon, authenticated;
GRANT SELECT ON public.application_errors TO authenticated;

-- The RPC validates actor identity using the authenticated session. Callers cannot
-- impersonate another user or write arbitrary audit records.
CREATE OR REPLACE FUNCTION public.record_client_audit_event(
  p_action text, p_summary text DEFAULT '', p_route text DEFAULT NULL,
  p_source text DEFAULT 'web', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_action NOT IN ('auth.sign_in','auth.sign_out','auth.sign_up','auth.password_recovery_requested') THEN
    RAISE EXCEPTION 'Unsupported client audit action';
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, route, source, summary, metadata)
  VALUES (v_actor, 'user', p_action, 'success', left(p_route, 500), left(p_source, 80), left(p_summary, 500), coalesce(p_metadata, '{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.record_client_audit_event(text,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_client_audit_event(text,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_application_error(
  p_severity text, p_source text, p_error_type text, p_message text,
  p_route text DEFAULT NULL, p_operation text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_correlation_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_severity NOT IN ('warning','error','critical') THEN RAISE EXCEPTION 'Invalid severity'; END IF;
  INSERT INTO public.application_errors(actor_user_id,severity,source,error_type,message,route,operation,event_id,correlation_id,details)
  VALUES (auth.uid(), p_severity, left(coalesce(p_source,'web'),80), left(coalesce(p_error_type,'ApplicationError'),200), left(coalesce(p_message,'Unknown error'),2000), left(p_route,500), left(p_operation,200), p_event_id, left(p_correlation_id,200), coalesce(p_details,'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.record_application_error(text,text,text,text,text,text,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_application_error(text,text,text,text,text,text,uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_row jsonb; v_id text; v_event_text text; v_event_id uuid; v_action text; v_changes jsonb := '{}'::jsonb; v_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  v_row := coalesce(v_new, v_old);
  v_id := coalesce(v_row->>'id', v_row->>'user_id', v_row->>'registration_id');
  v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME='events' THEN v_row->>'id' END);
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_action := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  IF TG_TABLE_NAME IN ('event_notification_queue','event_email_log') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_old->v_key IS DISTINCT FROM v_new->v_key AND v_key NOT IN ('updated_at','last_sign_in_at','email','phone','avatar_url','application_comment','password','token','secret','body','content','description','notes','metadata') THEN
        v_changes := v_changes || jsonb_build_object(v_key,jsonb_build_object('old',v_old->v_key,'new',v_new->v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSE
    v_changes := jsonb_build_object('record', (coalesce(v_new,v_old) - 'email' - 'phone' - 'application_comment' - 'address' - 'notes' - 'description' - 'content' - 'body' - 'metadata' - 'password' - 'token' - 'secret' - 'avatar_url'));
  END IF;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,target_record_id,event_id,source,summary,changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END, v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', CASE
    WHEN TG_TABLE_NAME='registrations' AND TG_OP='UPDATE' AND v_new->>'status'='withdrawn' THEN 'Member withdrew from an event'
    WHEN TG_TABLE_NAME='registrations' AND TG_OP='INSERT' THEN 'Member registered for an event'
    WHEN TG_TABLE_NAME='event_court_assignments' THEN 'Court assignment ' || lower(TG_OP)
    WHEN TG_TABLE_NAME='event_scores' THEN 'Match score ' || lower(TG_OP)
    ELSE replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP) END, v_changes);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','memberships','events','registrations','payments','event_court_assignments','event_scores','event_series','member_suspensions','member_admin_notes','club_settings','membership_plan_settings','news','gallery_albums','gallery_photos','legal_document_versions','documents','waiver_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
    END IF;
  END LOOP;
END $$;


-- Audit one database statement as one entry instead of emitting one entry per row.
-- This prevents bulk operations (for example, assigning many court slots) from
-- flooding the audit log with dozens of indistinguishable records.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count bigint := 0;
  v_row jsonb := '{}'::jsonb;
  v_id text;
  v_event_text text;
  v_event_id uuid;
  v_changes jsonb := '{}'::jsonb;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_row FROM new_rows n;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT count(*), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_row
      FROM new_rows n
      JOIN old_rows o ON coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'registration_id')
                     = coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'registration_id')
     WHERE (to_jsonb(n) - 'updated_at' - 'last_sign_in_at' - 'email' - 'phone' - 'avatar_url')
           IS DISTINCT FROM
           (to_jsonb(o) - 'updated_at' - 'last_sign_in_at' - 'email' - 'phone' - 'avatar_url');
    IF v_count = 0 THEN RETURN NULL; END IF;
  ELSE
    SELECT count(*), (array_agg(to_jsonb(o)))[1]
      INTO v_count, v_row FROM old_rows o;
  END IF;

  v_id := CASE WHEN v_count = 1 THEN coalesce(v_row->>'id', v_row->>'user_id', v_row->>'registration_id') ELSE NULL END;
  v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME = 'events' THEN v_row->>'id' END);
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;

  v_changes := jsonb_build_object(
    'affected_records', v_count,
    'sample_record', v_row - 'email' - 'phone' - 'application_comment' - 'address' - 'notes' - 'description' - 'content' - 'body' - 'metadata' - 'password' - 'token' - 'secret' - 'avatar_url'
  );
  v_summary := CASE
    WHEN TG_TABLE_NAME = 'registrations' AND TG_OP = 'INSERT' THEN 'Event registration created'
    WHEN TG_TABLE_NAME = 'registrations' AND TG_OP = 'UPDATE' AND v_row->>'status' = 'withdrawn' THEN 'Event registration updated'
    WHEN TG_TABLE_NAME = 'event_court_assignments' THEN 'Court assignments ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
    WHEN TG_TABLE_NAME = 'event_scores' THEN 'Match scores ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
    ELSE replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
  END;

  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, event_id, source, summary, changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', v_summary, v_changes);
  RETURN NULL;
END;
$$;

-- Notification delivery is infrastructure, not a user action. Remove any
-- trigger left behind by an earlier/manual installation as well.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_notification_queue','event_email_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','memberships','events','registrations','payments','event_court_assignments','event_scores','event_series','member_suspensions','member_admin_notes','club_settings','membership_plan_settings','news','gallery_albums','gallery_photos','legal_document_versions','documents','waiver_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_statement_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
    END IF;
  END LOOP;
END $$;


-- Court assignments are replaced using DELETE + INSERT today. Wrap those writes
-- in one RPC transaction and emit one business-action log for the whole save.
CREATE OR REPLACE FUNCTION public.save_event_court_assignments(
  p_event_id uuid,
  p_assignments jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Not authorized to manage event court assignments' USING ERRCODE = '42501';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be a JSON array';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    LEFT JOIN public.registrations r ON r.id = a.registration_id AND r.event_id = p_event_id AND r.status = 'confirmed'
    WHERE r.id IS NULL OR a.court_number NOT BETWEEN 1 AND 4 OR a.segment_order NOT BETWEEN 1 AND 4
  ) THEN
    RAISE EXCEPTION 'Invalid court assignment';
  END IF;
  SELECT count(*) INTO v_count FROM jsonb_to_recordset(p_assignments)
    AS a(registration_id uuid, court_number integer, segment_order integer);
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments)
      AS a(registration_id uuid, court_number integer, segment_order integer)
    GROUP BY registration_id, court_number, segment_order HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate court assignment';
  END IF;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  DELETE FROM public.event_court_assignments WHERE event_id = p_event_id;
  INSERT INTO public.event_court_assignments(event_id, registration_id, court_number, segment_order)
  SELECT p_event_id, a.registration_id, a.court_number, a.segment_order
  FROM jsonb_to_recordset(p_assignments)
    AS a(registration_id uuid, court_number integer, segment_order integer);
  PERFORM set_config('app.audit_suppressed', 'false', true);

  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, event_id, source, summary, changes)
  VALUES (auth.uid(), 'user', 'event_court_assignments.save', 'success', 'event_court_assignments', p_event_id,
          'database', 'Court assignments saved (' || v_count || ' assignment' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')',
          jsonb_build_object('affected_records', v_count));
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid,jsonb) TO authenticated;


-- Human-readable diffs for registrations and court assignment saves.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count bigint := 0;
  v_row jsonb := '{}'::jsonb;
  v_id text;
  v_event_text text;
  v_event_id uuid;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
  v_changes jsonb := '{}'::jsonb;
  v_people jsonb := '[]'::jsonb;
  v_old_row jsonb := '{}'::jsonb;
  v_field_diff jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;

  IF TG_TABLE_NAME = 'registrations' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
        'change', 'added', 'player_id', n.user_id, 'player_name', coalesce(p.full_name, p.email, n.user_id::text),
        'registration_id', n.id, 'event_id', n.event_id, 'new_status', n.status, 'new_queue_position', n.queue_position
      )), '[]'::jsonb), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_people, v_row FROM new_rows n LEFT JOIN public.profiles p ON p.id=n.user_id;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'added');
      v_summary := CASE WHEN v_count=1 THEN 'Registration added: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations added: ' || v_count || ' players' END;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
        'change', 'removed', 'player_id', o.user_id, 'player_name', coalesce(p.full_name, p.email, o.user_id::text),
        'registration_id', o.id, 'event_id', o.event_id, 'old_status', o.status, 'old_queue_position', o.queue_position
      )), '[]'::jsonb), (array_agg(to_jsonb(o)))[1]
      INTO v_count, v_people, v_row FROM old_rows o LEFT JOIN public.profiles p ON p.id=o.user_id;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'removed');
      v_summary := CASE WHEN v_count=1 THEN 'Registration removed: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations removed: ' || v_count || ' players' END;
    ELSE
      SELECT count(*) FILTER (WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at')),
        coalesce(jsonb_agg(jsonb_build_object(
          'change', CASE WHEN o.user_id IS DISTINCT FROM n.user_id THEN 'replaced' ELSE 'updated' END,
          'player_id', n.user_id, 'player_name', coalesce(pn.full_name,pn.email,n.user_id::text),
          'previous_player_id', o.user_id, 'previous_player_name', coalesce(po.full_name,po.email,o.user_id::text),
          'registration_id', n.id, 'event_id', n.event_id,
          'old_status', o.status, 'new_status', n.status,
          'old_queue_position', o.queue_position, 'new_queue_position', n.queue_position,
          'old_payment_status', o.payment_status, 'new_payment_status', n.payment_status
        )) FILTER (WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at')), '[]'::jsonb), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_people, v_row FROM new_rows n JOIN old_rows o ON o.id=n.id
      LEFT JOIN public.profiles pn ON pn.id=n.user_id LEFT JOIN public.profiles po ON po.id=o.user_id;
      IF v_count=0 THEN RETURN NULL; END IF;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'updated');
      v_summary := CASE WHEN v_count=1 THEN 'Registration updated: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations updated: ' || v_count || ' players' END;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN SELECT count(*), (array_agg(to_jsonb(n)))[1] INTO v_count,v_row FROM new_rows n;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT count(*), (array_agg(to_jsonb(n)))[1], (array_agg(to_jsonb(o)))[1] INTO v_count,v_row,v_old_row
      FROM new_rows n JOIN old_rows o ON coalesce(to_jsonb(n)->>'id',to_jsonb(n)->>'user_id',to_jsonb(n)->>'registration_id')=coalesce(to_jsonb(o)->>'id',to_jsonb(o)->>'user_id',to_jsonb(o)->>'registration_id')
      WHERE (to_jsonb(n)-'updated_at'-'last_sign_in_at'-'email'-'phone'-'avatar_url') IS DISTINCT FROM (to_jsonb(o)-'updated_at'-'last_sign_in_at'-'email'-'phone'-'avatar_url');
      IF v_count=0 THEN RETURN NULL; END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
        IF v_old_row->v_key IS DISTINCT FROM v_row->v_key AND v_key NOT IN ('updated_at','last_sign_in_at','email','phone','avatar_url','password','token','secret','body','content','description','notes','metadata') THEN
          v_field_diff := v_field_diff || jsonb_build_object(v_key,jsonb_build_object('old',v_old_row->v_key,'new',v_row->v_key));
        END IF;
      END LOOP;
    ELSE SELECT count(*), (array_agg(to_jsonb(o)))[1] INTO v_count,v_row FROM old_rows o;
    END IF;
    v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME='events' THEN v_row->>'id' END);
    v_changes := CASE WHEN TG_OP='UPDATE'
      THEN jsonb_build_object('affected_count',v_count,'operation','updated','record_id',coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id'),'field_changes',v_field_diff)
      ELSE jsonb_build_object('affected_count',v_count,'operation',lower(TG_OP),'record_id',coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id'),'changed_fields',to_jsonb(ARRAY(SELECT key FROM jsonb_object_keys(v_row) AS fields(key) WHERE key <> ALL(ARRAY['email','phone','application_comment','address','notes','description','content','body','metadata','password','token','secret','avatar_url']::text[])))) END;
    v_summary := CASE WHEN TG_TABLE_NAME='event_scores' THEN 'Match score ' || lower(TG_OP)
      ELSE replace(TG_TABLE_NAME,'_',' ') || ' ' || lower(TG_OP) END;
  END IF;

  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_id := CASE WHEN v_count=1 THEN coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id') ELSE NULL END;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,target_record_id,event_id,source,summary,changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END, v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', v_summary, v_changes);
  RETURN NULL;
END;
$$;

-- Court assignment save: capture actual player movement before replacing rows.
CREATE OR REPLACE FUNCTION public.save_event_court_assignments(p_event_id uuid, p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_changes jsonb := '[]'::jsonb;
  v_summary text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN RAISE EXCEPTION 'Assignments must be a JSON array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer);
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) WHERE court_number NOT BETWEEN 1 AND 4 OR segment_order NOT BETWEEN 1 AND 4) THEN RAISE EXCEPTION 'Invalid court or session'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) GROUP BY registration_id,segment_order HAVING count(*)>1) THEN RAISE EXCEPTION 'Player cannot be assigned to multiple courts in one session'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) LEFT JOIN public.registrations r ON r.id=a.registration_id AND r.event_id=p_event_id WHERE r.id IS NULL) THEN RAISE EXCEPTION 'Invalid registration for event'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'player_id', coalesce(n.user_id,o.user_id),
    'player_name', coalesce(p.full_name,p.email,coalesce(n.user_id,o.user_id)::text),
    'registration_id', coalesce(n.registration_id,o.registration_id),
    'session', coalesce(n.segment_order,o.segment_order),
    'previous_court', o.court_number,
    'new_court', n.court_number,
    'change', CASE WHEN o.court_number IS NULL THEN 'assigned' WHEN n.court_number IS NULL THEN 'unassigned' ELSE 'moved' END
  ) ORDER BY coalesce(n.segment_order,o.segment_order),coalesce(n.court_number,o.court_number)), '[]'::jsonb)
  INTO v_changes
  FROM (
    SELECT a.registration_id,a.court_number,a.segment_order,r.user_id FROM public.event_court_assignments a JOIN public.registrations r ON r.id=a.registration_id WHERE a.event_id=p_event_id
  ) o
  FULL JOIN (
    SELECT a.registration_id,a.court_number,a.segment_order,r.user_id FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) JOIN public.registrations r ON r.id=a.registration_id
  ) n ON n.registration_id=o.registration_id AND n.segment_order=o.segment_order
  LEFT JOIN public.profiles p ON p.id=coalesce(n.user_id,o.user_id)
  WHERE o.court_number IS DISTINCT FROM n.court_number;

  PERFORM set_config('app.audit_suppressed','true',true);
  DELETE FROM public.event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.event_court_assignments(event_id,registration_id,court_number,segment_order)
  SELECT p_event_id,a.registration_id,a.court_number,a.segment_order FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer);
  PERFORM set_config('app.audit_suppressed','false',true);

  v_summary := CASE WHEN jsonb_array_length(v_changes)=0 THEN 'Court assignments saved (no player movement)'
    ELSE 'Court assignments updated: ' || jsonb_array_length(v_changes) || ' player-session changes' END;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,event_id,source,summary,changes)
  VALUES(auth.uid(),'user','event_court_assignments.save','success','event_court_assignments',p_event_id,'database',v_summary,
    jsonb_build_object('player_changes',v_changes,'change_count',jsonb_array_length(v_changes),'assignments_after',v_count));
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid,jsonb) TO authenticated;

-- Give new audit records a stable schema and make multi-statement RPCs the
-- authoritative boundary for business actions.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS event_schema_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS actor_name_snapshot text;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_idx
  ON public.audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_business_audit_event(
  p_action text,
  p_summary text,
  p_target_table text,
  p_target_record_id text,
  p_event_id uuid,
  p_changes jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_route text DEFAULT NULL,
  p_source text DEFAULT 'rpc',
  p_idempotency_key text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id bigint;
  v_scoped_key text;
BEGIN
  v_scoped_key := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE
    concat_ws(':', coalesce(auth.uid()::text, 'system'), p_action, p_target_table,
      coalesce(p_target_record_id, ''), coalesce(p_event_id::text, ''), p_idempotency_key) END;
  INSERT INTO public.audit_logs(
    actor_user_id, actor_label, action, outcome, target_table, target_record_id,
    event_id, route, source, summary, changes, metadata, correlation_id,
    event_schema_version, idempotency_key, actor_name_snapshot
  ) VALUES (
    auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    p_action, 'success', p_target_table, p_target_record_id, p_event_id,
    left(p_route, 500), left(coalesce(p_source, 'rpc'), 80), left(p_summary, 500),
    coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb),
    coalesce(v_scoped_key, gen_random_uuid()::text), 2, v_scoped_key,
    (SELECT coalesce(p.full_name, p.email) FROM public.profiles p WHERE p.id = auth.uid())
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.audit_logs WHERE idempotency_key = v_scoped_key;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_business_audit_event(text,text,text,text,uuid,jsonb,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;

-- Non-RPC writes are still captured once per statement, with actual row-level
-- diffs grouped into one event rather than a count and an arbitrary sample row.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_entities jsonb := '[]'::jsonb;
  v_event_id uuid;
  v_event_text text;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('event_notification_queue', 'event_email_log') THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME, 'operation', 'created',
      'id', coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version'),
      'name', coalesce(to_jsonb(n)->>'full_name', to_jsonb(n)->>'title', to_jsonb(n)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(n)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(n)->>'event_id', 'user_id', to_jsonb(n)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(n)->>'event_id', '')::uuid),
      'new_values', to_jsonb(n) - 'password' - 'token' - 'secret' - 'credentials' - 'provider_reference'
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(n)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(n)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM new_rows n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME, 'operation', 'deleted',
      'id', coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'version'),
      'name', coalesce(to_jsonb(o)->>'full_name', to_jsonb(o)->>'title', to_jsonb(o)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(o)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(o)->>'event_id', 'user_id', to_jsonb(o)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(o)->>'event_id', '')::uuid),
      'old_values', to_jsonb(o) - 'password' - 'token' - 'secret' - 'credentials' - 'provider_reference'
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(o)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(o)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM old_rows o;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME,
      'id', coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version'),
      'name', coalesce(to_jsonb(n)->>'full_name', to_jsonb(n)->>'title', to_jsonb(n)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(n)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(n)->>'event_id', 'user_id', to_jsonb(n)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(n)->>'event_id', '')::uuid),
      'operation', 'updated',
      'field_changes', (
        SELECT coalesce(jsonb_object_agg(fields.key, jsonb_build_object(
          'old_value', to_jsonb(o)->fields.key, 'new_value', to_jsonb(n)->fields.key
        )), '{}'::jsonb)
        FROM (
          SELECT key FROM jsonb_object_keys(to_jsonb(n)) AS new_fields(key)
          UNION
          SELECT key FROM jsonb_object_keys(to_jsonb(o)) AS old_fields(key)
        ) fields
        WHERE to_jsonb(o)->fields.key IS DISTINCT FROM to_jsonb(n)->fields.key
          AND fields.key NOT IN ('updated_at', 'last_sign_in_at', 'password', 'token', 'secret', 'credentials', 'provider_reference')
      )
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(n)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(n)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM new_rows n
    JOIN old_rows o ON coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version', to_jsonb(n)->>'slug')
                    = coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'version', to_jsonb(o)->>'slug')
    WHERE to_jsonb(n) - 'updated_at' - 'last_sign_in_at'
      IS DISTINCT FROM to_jsonb(o) - 'updated_at' - 'last_sign_in_at';
    IF jsonb_array_length(v_entities) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF jsonb_array_length(v_entities) = 0 THEN RETURN NULL; END IF;
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_summary := replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP);
  PERFORM public.record_business_audit_event(
    v_action, v_summary, TG_TABLE_NAME, NULL, v_event_id,
    jsonb_build_object('entities', v_entities, 'operation', lower(TG_OP)),
    jsonb_build_object('database_operation', TG_OP, 'table', TG_TABLE_NAME),
    NULL, 'database', NULL
  );
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['club_contacts', 'membership_families', 'membership_family_members'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_statement_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
    END IF;
  END LOOP;
END;
$$;

-- Court assignment is keyed by a player's registration and session. The table's
-- surrogate row ID is deliberately not treated as the identity of a movement.
DROP FUNCTION IF EXISTS public.save_event_court_assignments(uuid, jsonb);
CREATE FUNCTION public.save_event_court_assignments(
  p_event_id uuid, p_assignments jsonb, p_idempotency_key text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_count integer;
  v_changes jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Event manager access required' USING ERRCODE = '42501';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be a JSON array';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    LEFT JOIN public.registrations r ON r.id = a.registration_id AND r.event_id = p_event_id
    WHERE r.id IS NULL OR a.court_number NOT BETWEEN 1 AND 4 OR a.segment_order NOT BETWEEN 1 AND 4
  ) THEN RAISE EXCEPTION 'Invalid registration, court, or session'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    GROUP BY registration_id, segment_order HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'A player cannot be assigned to multiple courts in one session'; END IF;

  SELECT count(*) INTO v_count
  FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer);

  WITH old_slots AS (
    SELECT a.registration_id, r.user_id, a.segment_order,
      array_agg(a.court_number ORDER BY a.court_number) AS courts
    FROM public.event_court_assignments a
    JOIN public.registrations r ON r.id = a.registration_id
    WHERE a.event_id = p_event_id
    GROUP BY a.registration_id, r.user_id, a.segment_order
  ), new_slots AS (
    SELECT a.registration_id, r.user_id, a.segment_order,
      array_agg(a.court_number ORDER BY a.court_number) AS courts
    FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    JOIN public.registrations r ON r.id = a.registration_id
    GROUP BY a.registration_id, r.user_id, a.segment_order
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'court_assignment',
    'change', CASE WHEN o.registration_id IS NULL THEN 'assigned' WHEN n.registration_id IS NULL THEN 'unassigned' ELSE 'moved' END,
    'player_id', coalesce(n.user_id, o.user_id),
    'player_name', coalesce(p.full_name, 'Player ' || coalesce(n.user_id, o.user_id)::text),
    'registration_id', coalesce(n.registration_id, o.registration_id),
    'session', coalesce(n.segment_order, o.segment_order),
    'previous_courts', coalesce(to_jsonb(o.courts), '[]'::jsonb),
    'new_courts', coalesce(to_jsonb(n.courts), '[]'::jsonb),
    'previous_court', CASE WHEN cardinality(o.courts) = 1 THEN o.courts[1] END,
    'new_court', CASE WHEN cardinality(n.courts) = 1 THEN n.courts[1] END
  ) ORDER BY coalesce(n.segment_order, o.segment_order), coalesce(p.full_name, '')),
  '[]'::jsonb) INTO v_changes
  FROM old_slots o FULL JOIN new_slots n
    ON n.registration_id = o.registration_id AND n.segment_order = o.segment_order
  LEFT JOIN public.profiles p ON p.id = coalesce(n.user_id, o.user_id)
  WHERE o.courts IS DISTINCT FROM n.courts;

  IF jsonb_array_length(v_changes) = 0 THEN RETURN; END IF;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  DELETE FROM public.event_court_assignments WHERE event_id = p_event_id;
  INSERT INTO public.event_court_assignments(event_id, registration_id, court_number, segment_order)
  SELECT p_event_id, a.registration_id, a.court_number, a.segment_order
  FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer);
  PERFORM set_config('app.audit_suppressed', 'false', true);

  PERFORM public.record_business_audit_event(
    'event_court_assignments.save',
    'Court assignments updated: ' || jsonb_array_length(v_changes) || ' player assignments changed',
    'event_court_assignments', p_event_id::text, p_event_id,
    jsonb_build_object('entities', v_changes, 'change_count', jsonb_array_length(v_changes)),
    jsonb_build_object('event_name', v_event.title, 'assignment_count_after', v_count),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid, jsonb, text) TO authenticated;

-- A registration or withdrawal owns one parent entry, including any waitlist
-- status and queue-position changes performed by the withdrawal trigger.
DROP FUNCTION IF EXISTS public.register_for_event(uuid);
CREATE FUNCTION public.register_for_event(p_event_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.';
  END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position), 0) + 1 INTO v_queue FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
  VALUES (p_event_id, v_user, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);
  PERFORM public.record_business_audit_event(
    'event.registration.created', 'Added ' || coalesce(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'new_queue_position', v_queue
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'queue_position', v_queue),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.withdraw_from_event(uuid);
CREATE FUNCTION public.withdraw_from_event(p_registration_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_registration public.registrations%rowtype;
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_before jsonb;
  v_changes jsonb;
BEGIN
  SELECT * INTO v_registration FROM public.registrations WHERE id = p_registration_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_registration.event_id;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN
    RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.';
  END IF;
  IF v_registration.status = 'cancelled' THEN RETURN; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_registration.user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_before
  FROM public.registrations r WHERE r.event_id = v_registration.event_id;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = p_registration_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'registration', 'change', CASE WHEN r.status = 'cancelled' THEN 'removed' ELSE 'updated' END,
    'player_id', r.user_id, 'player_name', coalesce(p.full_name, 'Player ' || r.user_id::text),
    'registration_id', r.id, 'event_id', r.event_id, 'event_name', v_event.title,
    'old_status', before_row.value->>'status', 'new_status', r.status,
    'old_queue_position', (before_row.value->>'queue_position')::bigint,
    'new_queue_position', r.queue_position
  ) ORDER BY r.created_at, r.id), '[]'::jsonb) INTO v_changes
  FROM jsonb_array_elements(v_before) AS before_row(value)
  JOIN public.registrations r ON r.id = (before_row.value->>'id')::uuid
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (before_row.value->>'status') IS DISTINCT FROM r.status::text
     OR (before_row.value->>'queue_position') IS DISTINCT FROM r.queue_position::text;

  PERFORM public.record_business_audit_event(
    'event.registration.withdrawn', 'Removed ' || coalesce(v_profile.full_name, 'a player') || ' from ' || v_event.title,
    'registrations', p_registration_id::text, v_event.id,
    jsonb_build_object('entities', v_changes, 'operation', 'withdrawn'),
    jsonb_build_object('registration_id', p_registration_id, 'event_id', v_event.id, 'event_name', v_event.title,
      'player_id', v_registration.user_id, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_registration.user_id::text)),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid, text) TO authenticated;

-- Administrator add/remove batches and their waitlist consequences are logged
-- once at the RPC boundary. Existing eligibility and capacity rules are retained.
DROP FUNCTION IF EXISTS public.manage_event_registration(uuid, uuid, text);
CREATE FUNCTION public.manage_event_registration(
  p_event_id uuid, p_user_id uuid, p_action text, p_idempotency_key text DEFAULT NULL
) RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_existing public.registrations%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_before jsonb;
  v_changes jsonb;
  v_operation text;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  PERFORM set_config('app.event_manager_override_suspension', 'on', true);
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_before
  FROM public.registrations r WHERE r.event_id = p_event_id;

  IF p_action = 'remove' THEN
    SELECT * INTO v_existing FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM set_config('app.audit_suppressed', 'true', true);
    UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = v_existing.id;
    PERFORM set_config('app.audit_suppressed', 'false', true);
    v_id := v_existing.id;
    v_status := 'cancelled';
    v_queue := NULL;
    v_operation := 'removed';
  ELSIF p_action = 'add' THEN
    IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'Member is already registered or waitlisted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.application_status = 'approved') THEN
      RAISE EXCEPTION 'Member must have an approved account';
    END IF;
    IF v_event.members_only AND NOT public.has_active_paid_membership(p_user_id) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
    SELECT count(*) INTO v_count FROM public.registrations WHERE event_id = p_event_id AND status = 'confirmed';
    IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
    ELSE
      IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
      SELECT coalesce(max(queue_position), 0) + 1 INTO v_queue FROM public.registrations WHERE event_id = p_event_id AND status = 'waitlisted';
      v_status := 'waitlisted';
    END IF;
    PERFORM set_config('app.audit_suppressed', 'true', true);
    INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
    VALUES (p_event_id, p_user_id, v_status, v_queue, v_event.price_cents,
      CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
    PERFORM set_config('app.audit_suppressed', 'false', true);
    v_operation := 'added';
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'registration', 'change', CASE WHEN r.status = 'cancelled' THEN 'removed' WHEN before_row.value IS NULL THEN 'added' ELSE 'updated' END,
    'player_id', r.user_id, 'player_name', coalesce(p.full_name, 'Player ' || r.user_id::text),
    'registration_id', r.id, 'event_id', r.event_id, 'event_name', v_event.title,
    'old_status', before_row.value->>'status', 'new_status', r.status,
    'old_queue_position', (before_row.value->>'queue_position')::bigint,
    'new_queue_position', r.queue_position
  ) ORDER BY r.created_at, r.id), '[]'::jsonb) INTO v_changes
  FROM public.registrations r
  LEFT JOIN LATERAL (
    SELECT item AS value FROM jsonb_array_elements(v_before) AS prior(item)
    WHERE item->>'id' = r.id::text LIMIT 1
  ) before_row ON true
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (before_row.value IS NULL AND r.id = v_id)
     OR (before_row.value IS NOT NULL AND ((before_row.value->>'status') IS DISTINCT FROM r.status::text
       OR (before_row.value->>'queue_position') IS DISTINCT FROM r.queue_position::text));

  PERFORM public.record_business_audit_event(
    CASE WHEN v_operation = 'added' THEN 'event.registration.admin_added' ELSE 'event.registration.admin_removed' END,
    CASE WHEN v_operation = 'added' THEN 'Added ' ELSE 'Removed ' END || coalesce(v_profile.full_name, 'a player') || ' ' ||
      CASE WHEN v_operation = 'added' THEN 'to ' ELSE 'from ' END || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', v_changes, 'operation', v_operation),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', p_user_id, 'player_name', coalesce(v_profile.full_name, 'Player ' || p_user_id::text)),
    NULL, 'rpc', p_idempotency_key
  );
  IF v_operation = 'added' THEN RETURN QUERY SELECT v_id, v_status, v_queue; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid, uuid, text, text) TO authenticated;

-- Participant replacement changes registrations, assignments, scores, and queue
-- positions but remains one administrator decision and one audit event.
DROP FUNCTION IF EXISTS public.replace_event_participant(uuid, uuid, uuid);
CREATE FUNCTION public.replace_event_participant(
  p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid, p_idempotency_key text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_old public.registrations%rowtype;
  v_new public.registrations%rowtype;
  v_old_profile public.profiles%rowtype;
  v_new_profile public.profiles%rowtype;
  v_assignment_count integer := 0;
  v_score_count integer := 0;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  PERFORM set_config('app.event_manager_override_suspension', 'on', true);
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT * INTO v_old FROM public.registrations WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed', 'waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  SELECT * INTO v_new FROM public.registrations WHERE event_id = p_event_id AND user_id = p_new_user_id AND status IN ('confirmed', 'waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_new.id IS NOT NULL AND v_new.status <> 'waitlisted' THEN RAISE EXCEPTION 'The selected member is already confirmed for this event.'; END IF;
  SELECT * INTO v_old_profile FROM public.profiles WHERE id = p_old_user_id;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id = p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.'; END IF;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  IF v_old.status = 'confirmed' AND v_new.status = 'waitlisted' THEN
    UPDATE public.event_court_assignments SET registration_id = v_new.id WHERE registration_id = v_old.id;
    GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
    UPDATE public.event_scores SET player_one_registration_id = v_new.id WHERE player_one_registration_id = v_old.id;
    GET DIAGNOSTICS v_score_count = ROW_COUNT;
    UPDATE public.event_scores SET player_two_registration_id = v_new.id WHERE player_two_registration_id = v_old.id;
    UPDATE public.event_scores SET player_three_registration_id = v_new.id WHERE player_three_registration_id = v_old.id;
    UPDATE public.event_scores SET player_four_registration_id = v_new.id WHERE player_four_registration_id = v_old.id;
    UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = v_old.id;
    UPDATE public.registrations SET status = 'confirmed', queue_position = NULL, updated_at = now() WHERE id = v_new.id;
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY queue_position NULLS LAST, created_at, id) AS new_position
      FROM public.registrations WHERE event_id = p_event_id AND status = 'waitlisted'
    )
    UPDATE public.registrations r SET queue_position = ranked.new_position, updated_at = now()
    FROM ranked WHERE r.id = ranked.id;
  ELSIF v_new.id IS NULL THEN
    UPDATE public.registrations SET user_id = p_new_user_id, updated_at = now() WHERE id = v_old.id;
  ELSE
    RAISE EXCEPTION 'The selected member cannot replace this player.';
  END IF;
  PERFORM set_config('app.audit_suppressed', 'false', true);

  PERFORM public.record_business_audit_event(
    'event.registration.replaced', 'Replaced ' || coalesce(v_old_profile.full_name, 'a player') || ' with ' ||
      coalesce(v_new_profile.full_name, 'a player') || ' in ' || v_event.title,
    'registrations', coalesce(v_new.id, v_old.id)::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'replaced', 'player_id', p_new_user_id,
      'player_name', coalesce(v_new_profile.full_name, 'Player ' || p_new_user_id::text),
      'previous_player_id', p_old_user_id,
      'previous_player_name', coalesce(v_old_profile.full_name, 'Player ' || p_old_user_id::text),
      'registration_id', coalesce(v_new.id, v_old.id), 'previous_registration_id', v_old.id,
      'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', v_old.status, 'new_status', CASE WHEN v_new.id IS NOT NULL THEN 'confirmed' ELSE v_old.status END
    )), 'operation', 'replaced'),
    jsonb_build_object('event_id', p_event_id, 'event_name', v_event.title,
      'previous_player_id', p_old_user_id, 'previous_player_name', v_old_profile.full_name,
      'replacement_player_id', p_new_user_id, 'replacement_player_name', v_new_profile.full_name,
      'previous_registration_id', v_old.id, 'replacement_registration_id', coalesce(v_new.id, v_old.id),
      'transferred_assignment_count', v_assignment_count, 'updated_score_rows', v_score_count),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid, uuid, uuid, text) TO authenticated;
-- Preserve the event creator for permissions/audit, while allowing an admin to
-- assign a separate event organizer.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.events e
SET organizer_id = e.created_by
WHERE e.organizer_id IS NULL
  AND e.created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = e.created_by);

CREATE INDEX IF NOT EXISTS events_organizer_id_idx ON public.events (organizer_id);

CREATE OR REPLACE FUNCTION public.validate_event_organizer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.organizer_id IS NULL THEN
    NEW.organizer_id := NEW.created_by;
  END IF;

  IF NEW.organizer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.organizer_id AND p.role IN ('admin', 'organizer')
  ) THEN
    RAISE EXCEPTION 'Event organizer must be an administrator or organizer';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (
    NEW.organizer_id IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only administrators can assign another event organizer' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_event_organizer ON public.events;
CREATE TRIGGER validate_event_organizer
BEFORE INSERT OR UPDATE OF organizer_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_organizer();

-- Organizer names and private contact information are returned only to
-- approved members who have paid a membership fee at least once.
CREATE OR REPLACE FUNCTION public.event_organizer_contacts(p_event_id uuid)
RETURNS TABLE(
  organizer_id uuid,
  organizer_name text,
  "position" text,
  emails text[],
  phones text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_ever_paid_membership(auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    coalesce(nullif(p.full_name, ''), p.email),
    coalesce(cc.position, CASE WHEN p.role = 'organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
    coalesce(nullif(cc.emails, ARRAY[]::text[]), ARRAY[p.email]::text[]),
    coalesce(nullif(cc.phones, ARRAY[]::text[]), ARRAY[p.phone]::text[])
  FROM public.events e
  JOIN public.profiles p ON p.id = coalesce(e.organizer_id, e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id = p.id
  WHERE e.id = p_event_id AND e.status IN ('published', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.event_organizer_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_organizer_contacts(uuid) TO authenticated;
-- Single shared group chat for approved club members.
CREATE TABLE IF NOT EXISTS public.member_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT member_chat_message_content CHECK (
    (length(btrim(body)) > 0 OR image_path IS NOT NULL)
    AND length(body) <= 4000
  )
);
CREATE INDEX IF NOT EXISTS member_chat_messages_created_idx
  ON public.member_chat_messages (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS member_chat_messages_user_idx
  ON public.member_chat_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.member_chat_reads (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_chat_messages, public.member_chat_reads FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.member_chat_reads TO authenticated;

DROP POLICY IF EXISTS "Approved members can read chat messages" ON public.member_chat_messages;
CREATE POLICY "Approved members can read chat messages"
  ON public.member_chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Approved members can send chat messages" ON public.member_chat_messages;
CREATE POLICY "Approved members can send chat messages"
  ON public.member_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved')
  );
DROP POLICY IF EXISTS "Authors can update own recent chat messages" ON public.member_chat_messages;
CREATE POLICY "Authors can update own recent chat messages"
  ON public.member_chat_messages FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'))
  WITH CHECK (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes');
DROP POLICY IF EXISTS "Authors can delete own recent chat messages" ON public.member_chat_messages;
CREATE POLICY "Authors can delete own recent chat messages"
  ON public.member_chat_messages FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));

DROP POLICY IF EXISTS "Members can read own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can read own chat read marker" ON public.member_chat_reads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members can insert own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can insert own chat read marker" ON public.member_chat_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members can update own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can update own chat read marker" ON public.member_chat_reads FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Chat messages must be sent as the authenticated user' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := NULL;
    NEW.deleted_at := NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.image_path IS DISTINCT FROM NEW.image_path OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      RAISE EXCEPTION 'Only chat message text can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_member_chat_message ON public.member_chat_messages;
CREATE TRIGGER guard_member_chat_message BEFORE INSERT OR UPDATE OR DELETE ON public.member_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_member_chat_message();

CREATE OR REPLACE FUNCTION public.trim_member_chat_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Keep the newest 2,000 messages in the single shared conversation.
  DELETE FROM public.member_chat_messages
  WHERE id IN (
    SELECT id FROM public.member_chat_messages
    ORDER BY created_at DESC, id DESC
    OFFSET 2000
  );
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trim_member_chat_history ON public.member_chat_messages;
CREATE TRIGGER trim_member_chat_history AFTER INSERT ON public.member_chat_messages
FOR EACH STATEMENT EXECUTE FUNCTION public.trim_member_chat_history();

-- Restrict the public bucket to small images uploaded by approved members.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-chat-images', 'member-chat-images', false, 1048576, ARRAY['image/jpeg','image/png','image/gif','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1048576,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/gif','image/webp'];
DROP POLICY IF EXISTS "Approved members can read chat images" ON storage.objects;
CREATE POLICY "Approved members can read chat images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'member-chat-images' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Approved members can upload own chat images" ON storage.objects;
CREATE POLICY "Approved members can upload own chat images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'member-chat-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved')
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','gif','webp'));
DROP POLICY IF EXISTS "Members can delete own chat images" ON storage.objects;
CREATE POLICY "Members can delete own chat images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'member-chat-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));

-- Realtime delivers committed inserts/updates/deletes; chat is intentionally excluded from audit logging.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN undefined_object THEN NULL;
END $$;
-- Member-configurable in-app chat notifications and mention recipients.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chat_notification_preference text NOT NULL DEFAULT 'all';
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_chat_notification_preference_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_chat_notification_preference_check
  CHECK (chat_notification_preference IN ('all', 'mentions', 'none'));

ALTER TABLE public.member_chat_messages
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  mention_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Chat messages must be sent as the authenticated user' USING ERRCODE = '42501';
    END IF;
    FOREACH mention_id IN ARRAY NEW.mentions LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = mention_id AND p.application_status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Only approved members can be mentioned' USING ERRCODE = '42501';
      END IF;
    END LOOP;
    NEW.created_at := now();
    NEW.updated_at := NULL;
    NEW.deleted_at := NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.image_path IS DISTINCT FROM NEW.image_path OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
      OR OLD.mentions IS DISTINCT FROM NEW.mentions THEN
      RAISE EXCEPTION 'Only chat message text can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
-- Chat messages intentionally remain excluded from audit logging.

-- Expose only the minimum member directory fields needed by approved-member chat.
-- This avoids broadening direct SELECT access to the profiles table.
CREATE OR REPLACE FUNCTION public.get_member_chat_member_names()
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Member') AS full_name
  FROM public.profiles AS p
  WHERE p.application_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS caller
      WHERE caller.id = (SELECT auth.uid())
        AND caller.application_status = 'approved'
    )
  ORDER BY COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Member');
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_member_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_member_names() TO authenticated;
-- Chat remains excluded from audit logging.

-- Keep chat presence connected across the member portal, bound unread-count queries,
-- and queue storage objects for deletion whenever their messages are deleted/pruned.
ALTER TABLE public.member_chat_reads
  ADD COLUMN IF NOT EXISTS last_read_message_id uuid;

CREATE INDEX IF NOT EXISTS member_chat_messages_unread_idx
  ON public.member_chat_messages (created_at, id, user_id);

CREATE OR REPLACE FUNCTION public.get_member_chat_unread_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.member_chat_messages AS m
  LEFT JOIN public.member_chat_reads AS r ON r.user_id = (SELECT auth.uid())
  WHERE m.user_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'
    )
    AND (
      r.user_id IS NULL
      OR (m.created_at, m.id) > (r.last_read_at, COALESCE(r.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid))
    );
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_unread_count() TO authenticated;

CREATE TABLE IF NOT EXISTS public.member_chat_image_cleanup_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_chat_image_cleanup_queue_created_idx
  ON public.member_chat_image_cleanup_queue (created_at, id);
ALTER TABLE public.member_chat_image_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_chat_image_cleanup_queue FROM anon, authenticated, PUBLIC;
GRANT SELECT, DELETE ON public.member_chat_image_cleanup_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_member_chat_image_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.image_path IS NOT NULL AND btrim(OLD.image_path) <> '' THEN
    INSERT INTO public.member_chat_image_cleanup_queue (image_path)
    VALUES (OLD.image_path)
    ON CONFLICT (image_path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_member_chat_image_cleanup ON public.member_chat_messages;
CREATE TRIGGER enqueue_member_chat_image_cleanup
AFTER DELETE ON public.member_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.enqueue_member_chat_image_cleanup();

-- The retention trigger must be able to prune old messages despite the five-minute
-- user-facing deletion restriction. This transaction-local flag is only set by the
-- SECURITY DEFINER retention function below.
CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mention_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Chat messages must be sent as the authenticated user' USING ERRCODE = '42501';
    END IF;
    FOREACH mention_id IN ARRAY NEW.mentions LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = mention_id AND p.application_status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Only approved members can be mentioned' USING ERRCODE = '42501';
      END IF;
    END LOOP;
    NEW.created_at := now();
    NEW.updated_at := NULL;
    NEW.deleted_at := NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.image_path IS DISTINCT FROM NEW.image_path OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
      OR OLD.mentions IS DISTINCT FROM NEW.mentions THEN
      RAISE EXCEPTION 'Only chat message text can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF current_setting('pctc.chat_history_prune', true) IS DISTINCT FROM 'on'
      AND OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trim_member_chat_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('pctc.chat_history_prune', 'on', true);
  DELETE FROM public.member_chat_messages
  WHERE id IN (
    SELECT id FROM public.member_chat_messages
    ORDER BY created_at DESC, id DESC
    OFFSET 2000
  );
  PERFORM set_config('pctc.chat_history_prune', 'off', true);
  RETURN NULL;
END;
$$;

-- Read-marker changes also drive live unread badge updates.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_chat_reads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;
-- Chat remains intentionally excluded from audit logging.
-- Expose only approved members' avatar URLs to the approved-member chat.
-- Direct profile-table access is intentionally not broadened.
CREATE OR REPLACE FUNCTION public.get_member_chat_member_avatars(p_user_ids uuid[])
RETURNS TABLE (id uuid, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.avatar_url
  FROM public.profiles AS p
  WHERE p.id = ANY(p_user_ids)
    AND p.application_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS caller
      WHERE caller.id = (SELECT auth.uid())
        AND caller.application_status = 'approved'
    );
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_member_avatars(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_member_avatars(uuid[]) TO authenticated;
-- Chat remains excluded from audit logging.
-- Payments Foundation. This migration upgrades the legacy PCTC payments table in place
-- and is safe to rerun after a partial/manual application.

-- PostgREST upserts use this named unique key. PostgreSQL permits multiple NULLs
-- in a non-partial unique index, so legacy audit rows remain valid.
DROP INDEX IF EXISTS public.audit_logs_idempotency_key_idx;
CREATE UNIQUE INDEX audit_logs_idempotency_key_idx ON public.audit_logs (idempotency_key);

-- Create the target shape when payments does not yet exist. On existing installations
-- this is a no-op; the ALTER/normalization steps below upgrade the legacy table.
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  purpose text,
  business_record_id text,
  amount_minor bigint,
  currency text NOT NULL DEFAULT 'cad',
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  last_stripe_event_id text,
  failure_code text,
  failure_message text,
  refunded_amount_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz
);

-- Add missing target columns to the pre-existing legacy payments table.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS business_record_id text,
  ADD COLUMN IF NOT EXISTS amount_minor bigint,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS last_stripe_event_id text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS refunded_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS succeeded_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_status text;

-- Remove legacy checks/triggers before translating old statuses and currencies.
DROP TRIGGER IF EXISTS guard_payment_status_transition ON public.payments;
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check,
  DROP CONSTRAINT IF EXISTS payments_currency_check,
  DROP CONSTRAINT IF EXISTS payments_amount_minor_check,
  DROP CONSTRAINT IF EXISTS payments_purpose_check,
  DROP CONSTRAINT IF EXISTS payments_amount_check,
  DROP CONSTRAINT IF EXISTS payments_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS payments_refunded_amount_check,
  DROP CONSTRAINT IF EXISTS payments_refund_status_check,
  DROP CONSTRAINT IF EXISTS payments_fully_refunded_check;

-- Preserve legacy values and map old records to the new lifecycle/model.
UPDATE public.payments
SET legacy_status = COALESCE(legacy_status, status);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE amount_minor IS NULL AND amount_cents IS NULL
  ) THEN
    RAISE EXCEPTION 'Payments migration cannot infer amount_minor for an existing row';
  END IF;
END;
$$;

-- JSON row access keeps this upgrade compatible with both the legacy schema
-- (membership_id/registration_id/amount_cents/paid_at) and an already-upgraded
-- table where those legacy columns are no longer present.
UPDATE public.payments AS p
SET
  purpose = COALESCE(
    p.purpose,
    CASE
      WHEN to_jsonb(p)->>'membership_id' IS NOT NULL THEN 'membership'
      WHEN to_jsonb(p)->>'registration_id' IS NOT NULL THEN 'event_registration'
      ELSE 'other'
    END
  ),
  business_record_id = COALESCE(
    p.business_record_id,
    to_jsonb(p)->>'membership_id',
    to_jsonb(p)->>'registration_id'
  ),
  amount_minor = COALESCE(p.amount_minor, (to_jsonb(p)->>'amount_cents')::bigint),
  currency = lower(p.currency),
  idempotency_key = COALESCE(p.idempotency_key, 'legacy:' || p.id::text),
  succeeded_at = CASE
    WHEN p.status IN ('paid', 'recorded_manually') THEN
      COALESCE(p.succeeded_at, (to_jsonb(p)->>'paid_at')::timestamptz)
    ELSE p.succeeded_at
  END,
  status = CASE p.status
    WHEN 'paid' THEN 'succeeded'
    WHEN 'recorded_manually' THEN 'succeeded'
    WHEN 'refunded' THEN 'refunded'
    ELSE p.status
  END;

-- Legacy rows marked refunded predate the refund ledger; the old status implies
-- a full refund, so normalize the aggregate amount accordingly.
UPDATE public.payments
SET refunded_amount_minor = amount_minor
WHERE status = 'refunded'
  AND refunded_amount_minor = 0
  AND legacy_status = 'refunded';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE purpose NOT IN ('membership', 'event_registration', 'other')
       OR amount_minor IS NULL OR amount_minor <= 0
       OR currency !~ '^[a-z]{3}$'
       OR idempotency_key IS NULL
       OR length(idempotency_key) NOT BETWEEN 1 AND 200
       OR status NOT IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded')
       OR refunded_amount_minor < 0 OR refunded_amount_minor > amount_minor
       OR (status IN ('partially_refunded', 'refunded') AND refunded_amount_minor = 0)
       OR (status = 'refunded' AND refunded_amount_minor <> amount_minor)
  ) THEN
    RAISE EXCEPTION 'Payments migration found a row that does not satisfy the Stripe payment model';
  END IF;
END;
$$;

ALTER TABLE public.payments
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN amount_minor SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_purpose_check
    CHECK (purpose IN ('membership', 'event_registration', 'other')),
  ADD CONSTRAINT payments_amount_minor_check CHECK (amount_minor > 0),
  ADD CONSTRAINT payments_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  ADD CONSTRAINT payments_status_check CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded'
  )),
  ADD CONSTRAINT payments_idempotency_key_check
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  ADD CONSTRAINT payments_refunded_amount_check
    CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor),
  ADD CONSTRAINT payments_refund_status_check
    CHECK (status NOT IN ('partially_refunded', 'refunded') OR refunded_amount_minor > 0),
  ADD CONSTRAINT payments_fully_refunded_check
    CHECK (status <> 'refunded' OR refunded_amount_minor = amount_minor);

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx ON public.payments(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_session_uidx
  ON public.payments(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_uidx
  ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_created_idx ON public.payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_created_idx ON public.payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_business_record_idx ON public.payments(purpose, business_record_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own payments" ON public.payments;
CREATE POLICY "Users read own payments" ON public.payments
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.payments FROM anon, authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  stripe_refund_id text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  status text NOT NULL CHECK (status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'unknown')),
  reason text,
  last_stripe_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx ON public.payment_refunds(payment_id, created_at);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own payment refunds" ON public.payment_refunds;
CREATE POLICY "Users read own payment refunds" ON public.payment_refunds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND p.user_id = (SELECT auth.uid()))
  );
REVOKE ALL ON public.payment_refunds FROM anon, authenticated;
GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_idx ON public.stripe_webhook_events(processing_status, updated_at);
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

-- Atomic event claim: processed events cannot be claimed again. Failed events can
-- be retried; stale in-flight claims can be reclaimed after five minutes.
CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_livemode boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_claimed text;
BEGIN
  INSERT INTO public.stripe_webhook_events(stripe_event_id, event_type, livemode, processing_status, attempts)
  VALUES (p_event_id, p_event_type, p_livemode, 'processing', 1)
  ON CONFLICT (stripe_event_id) DO UPDATE SET
    processing_status = 'processing',
    attempts = public.stripe_webhook_events.attempts + 1,
    updated_at = now(),
    last_error = NULL
  WHERE public.stripe_webhook_events.processing_status = 'failed'
     OR (public.stripe_webhook_events.processing_status = 'processing'
         AND public.stripe_webhook_events.updated_at < now() - interval '5 minutes')
  RETURNING stripe_event_id INTO v_claimed;
  RETURN v_claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, boolean) TO service_role;

-- Enforce payment lifecycle transitions after legacy statuses have been normalized.
CREATE OR REPLACE FUNCTION public.guard_payment_status_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('processing','succeeded','failed','canceled')) OR
    (OLD.status = 'processing' AND NEW.status IN ('succeeded','failed','canceled')) OR
    (OLD.status = 'failed' AND NEW.status IN ('pending','processing','succeeded','canceled')) OR
    (OLD.status = 'succeeded' AND NEW.status IN ('partially_refunded','refunded')) OR
    (OLD.status = 'partially_refunded' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'Invalid payment status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_payment_status_transition ON public.payments;
CREATE TRIGGER guard_payment_status_transition BEFORE UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_status_transition();

-- Refund records must use the payment's currency.
CREATE OR REPLACE FUNCTION public.guard_payment_refund_currency() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_currency text;
BEGIN
  SELECT currency INTO v_currency FROM public.payments WHERE id = NEW.payment_id;
  IF v_currency IS NULL OR NEW.currency <> v_currency THEN
    RAISE EXCEPTION 'Refund currency must match its payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_payment_refund_currency ON public.payment_refunds;
CREATE TRIGGER guard_payment_refund_currency BEFORE INSERT OR UPDATE ON public.payment_refunds
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_refund_currency();

-- Reconcile membership eligibility helpers with the Stripe payments schema.
-- The payments foundation stores the related business row in business_record_id
-- and uses 'succeeded' instead of the legacy 'paid'/'recorded_manually' statuses.
-- Keep memberships.payment_status and family-plan coverage as valid fallbacks.

CREATE OR REPLACE FUNCTION public.is_paid_member()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status = 'succeeded'
        )
      )
      AND (m.starts_on IS NULL OR m.starts_on <= current_date)
      AND (m.ends_on IS NULL OR m.ends_on >= current_date)
  );
$$;
-- Preserve the original public execute grant: public_club_contacts also calls this
-- boolean helper for anonymous visitors, for whom auth.uid() is NULL.
GRANT EXECUTE ON FUNCTION public.is_paid_member() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.memberships m ON m.user_id = pr.id
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status = 'succeeded'
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user
        AND m.status = 'active'
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
        AND (
          m.payment_status = 'paid'
          OR EXISTS (
            SELECT 1
            FROM public.payments p
            WHERE p.purpose = 'membership'
              AND p.business_record_id = m.id::text
              AND p.status = 'succeeded'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = v_user
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_paid_membership(uuid) TO authenticated;

-- Record waiver acceptance for each person covered by a family membership.
ALTER TABLE public.membership_family_members
  ADD COLUMN IF NOT EXISTS waiver_version text,
  ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamptz;

-- Fulfill paid business records only after the Stripe webhook has marked the
-- internal payment succeeded. This is idempotent and callable only by service_role.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;
  IF v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Only succeeded payments can be fulfilled';
  END IF;

  IF v_payment.purpose = 'membership' THEN
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid family reference on payment';
      END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      UPDATE public.membership_families
      SET paid_at = COALESCE(paid_at, now()),
          paid_by = COALESCE(paid_by, v_payment.user_id),
          payment_id = COALESCE(payment_id, v_payment.id)
      WHERE id = v_family_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    ELSIF v_payment.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_membership_id := v_payment.business_record_id::uuid;
      UPDATE public.memberships
      SET status = 'active', payment_status = 'paid', updated_at = now()
      WHERE id = v_membership_id AND user_id = v_payment.user_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'Membership or family record was not found for payment';
  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid registration reference on payment';
    END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r
    SET payment_status = 'paid',
        payment_provider = 'stripe',
        provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id),
        updated_at = now()
    FROM public.events e
    WHERE r.id = v_registration_id
      AND r.event_id = e.id
      AND r.user_id = v_payment.user_id
      AND r.status = 'confirmed'
      AND r.amount_cents = v_payment.amount_minor
      AND e.price_cents = v_payment.amount_minor
      AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Prevent concurrent checkout attempts from creating multiple active charges for
-- the same membership/family or event registration. Failed/canceled attempts may retry.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_business_payment_uidx
  ON public.payments(purpose, business_record_id)
  WHERE business_record_id IS NOT NULL
    AND status IN ('pending', 'processing', 'succeeded', 'partially_refunded', 'refunded');

-- Safe no-argument wrapper for a view that is also readable by anon. It only
-- evaluates the caller's own membership and does not expose arbitrary user IDs.
CREATE OR REPLACE FUNCTION public.current_user_has_active_paid_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_active_paid_membership((SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.current_user_has_active_paid_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_active_paid_membership() TO anon, authenticated;

-- Rebuild views and policies that were originally written against the legacy payment foreign key. These use the canonical eligibility helper.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id
JOIN public.events e ON e.id = r.event_id
WHERE (e.status = 'published' OR public.is_event_manager())
  AND r.status IN ('confirmed', 'waitlisted')
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = (SELECT auth.uid()) AND me.application_status = 'approved')
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = e.id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;

DROP VIEW IF EXISTS public.event_scoreboard;
CREATE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name, s.entered_by
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id = s.player_one_registration_id
JOIN public.profiles p1 ON p1.id = r1.user_id
JOIN public.registrations r2 ON r2.id = s.player_two_registration_id
JOIN public.profiles p2 ON p2.id = r2.user_id
LEFT JOIN public.registrations r3 ON r3.id = s.player_three_registration_id
LEFT JOIN public.profiles p3 ON p3.id = r3.user_id
LEFT JOIN public.registrations r4 ON r4.id = s.player_four_registration_id
LEFT JOIN public.profiles p4 ON p4.id = r4.user_id
JOIN public.events e ON e.id = s.event_id
WHERE e.event_type <> 'tournament'
  AND (e.status = 'published' OR public.is_event_manager())
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = (SELECT auth.uid()) AND me.application_status = 'approved')
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = e.id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments
FOR SELECT TO authenticated USING (
  public.is_event_manager()
  OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = event_court_assignments.event_id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
    AND public.current_user_has_active_paid_membership()
  )
);

DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores
FOR SELECT TO authenticated USING (
  public.is_event_manager()
  OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = event_scores.event_id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
    AND public.current_user_has_active_paid_membership()
  )
);

CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id INTO old_reg FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed', 'waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id AND user_id = p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id = p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  UPDATE public.registrations SET user_id = p_new_user_id, updated_at = now() WHERE id = old_reg;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid, uuid, uuid) TO authenticated;

-- Resolve the club's current season consistently for individual and family eligibility.
CREATE OR REPLACE FUNCTION public.current_membership_season_year()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH settings AS (
    SELECT
      COALESCE((SELECT season_start_month FROM public.membership_plan_settings WHERE id = 1), 4) AS start_month,
      COALESCE((SELECT season_start_day FROM public.membership_plan_settings WHERE id = 1), 1) AS start_day,
      COALESCE((SELECT season_end_month FROM public.membership_plan_settings WHERE id = 1), 9) AS end_month,
      COALESCE((SELECT season_end_day FROM public.membership_plan_settings WHERE id = 1), 30) AS end_day,
      EXTRACT(YEAR FROM current_date)::integer AS year,
      EXTRACT(MONTH FROM current_date)::integer * 100 + EXTRACT(DAY FROM current_date)::integer AS today_key
  )
  SELECT CASE
    WHEN today_key < start_month * 100 + start_day THEN year
    WHEN today_key > end_month * 100 + end_day THEN year + 1
    ELSE year
  END
  FROM settings;
$$;
REVOKE ALL ON FUNCTION public.current_membership_season_year() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_paid_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND (m.payment_status = 'paid' OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
        ))
        AND (m.starts_on IS NULL OR m.starts_on <= current_date)
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND f.season_year = public.current_membership_season_year()
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_paid_member() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        EXISTS (
          SELECT 1 FROM public.memberships m
          WHERE m.user_id = pr.id
            AND (m.payment_status = 'paid' OR EXISTS (
              SELECT 1 FROM public.payments p
              WHERE p.purpose = 'membership'
                AND p.business_record_id = m.id::text
                AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
            ))
        )
        OR EXISTS (
          SELECT 1
          FROM public.membership_family_members fm
          JOIN public.membership_families f ON f.id = fm.family_id
          WHERE fm.user_id = pr.id
            AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user
        AND m.status = 'active'
        AND (m.starts_on IS NULL OR m.starts_on <= current_date)
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
        AND (m.payment_status = 'paid' OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
        ))
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = v_user
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND f.season_year = public.current_membership_season_year()
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_paid_membership(uuid) TO authenticated;


-- Expose payment state on the event roster so unpaid reservations are displayed as pending.
-- Keep the existing roster visibility rules unchanged.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT
  r.id AS registration_id,
  r.event_id,
  r.user_id,
  r.status,
  r.queue_position,
  r.created_at AS registered_at,
  p.full_name,
  p.avatar_url,
  p.tennis_skill_level,
  r.payment_status
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id
JOIN public.events e ON e.id = r.event_id
WHERE (e.status = 'published' OR public.is_event_manager())
  AND r.status IN ('confirmed', 'waitlisted')
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles me
        WHERE me.id = (SELECT auth.uid())
          AND me.application_status = 'approved'
      )
      AND EXISTS (
        SELECT 1
        FROM public.registrations own
        WHERE own.event_id = e.id
          AND own.user_id = (SELECT auth.uid())
          AND own.status IN ('confirmed', 'waitlisted')
      )
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;


-- Payment history proceeds and safe reuse of non-refunded tournament payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_fee_minor bigint,
  ADD COLUMN IF NOT EXISTS proceeds_minor bigint;

COMMENT ON COLUMN public.payments.stripe_fee_minor IS 'Stripe processing fee from the charge balance transaction, in minor currency units.';
COMMENT ON COLUMN public.payments.proceeds_minor IS 'Net proceeds from the charge balance transaction, in minor currency units.';

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_prior_payment public.payments%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.';
  END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position), 0) + 1 INTO v_queue FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;
  -- Reuse a prior successful, never-refunded payment when the same member
  -- withdraws and later registers for this same event at the same price.
  -- A waitlisted registration is not marked paid until it has a confirmed place.
  IF v_event.price_cents > 0 AND v_status = 'confirmed' THEN
    SELECT p.* INTO v_prior_payment
    FROM public.payments p
    JOIN public.registrations previous_registration
      ON previous_registration.id::text = p.business_record_id
    WHERE p.user_id = v_user
      AND p.purpose = 'event_registration'
      AND p.status = 'succeeded'
      AND COALESCE(p.refunded_amount_minor, 0) = 0
      AND p.amount_minor = v_event.price_cents
      AND previous_registration.event_id = p_event_id
      AND previous_registration.user_id = v_user
      AND previous_registration.status = 'cancelled'
    ORDER BY p.succeeded_at DESC NULLS LAST, p.created_at DESC
    LIMIT 1;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(
    event_id, user_id, status, queue_position, amount_cents, payment_status,
    payment_provider, provider_reference
  )
  VALUES (
    p_event_id, v_user, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required'
         WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN 'paid'
         ELSE 'pending' END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN 'stripe' ELSE NULL END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL
         THEN COALESCE(v_prior_payment.stripe_payment_intent_id, v_prior_payment.stripe_checkout_session_id)
         ELSE NULL END
  )
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);
  PERFORM public.record_business_audit_event(
    'event.registration.created', 'Added ' || coalesce(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'new_queue_position', v_queue
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'queue_position', v_queue),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, text) TO authenticated;


-- Track payment reminders per registration so withdrawn/re-registered members
-- can receive reminders for the new registration without duplicating old sends.
CREATE TABLE IF NOT EXISTS public.event_registration_payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('24h', '1h')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (registration_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS event_registration_payment_reminders_event_idx
  ON public.event_registration_payment_reminders(event_id, reminder_type, sent_at);

ALTER TABLE public.event_registration_payment_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_registration_payment_reminders FROM PUBLIC, anon, authenticated;

-- Migration 0045: Interac manual payment review foundation.
-- Safe to apply after 0044. This is database support only; member/admin UI,
-- initiation APIs and notification delivery must be implemented separately.

-- Preserve any pre-existing provider values from the legacy payments schema.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS manual_review_status text,
  ADD COLUMN IF NOT EXISTS manual_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_instructions_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_instructions_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_outcome_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_outcome_claimed_at timestamptz;

-- In older deployments `provider` already existed with the value `etransfer`.
-- Drop its legacy check before normalizing, then preserve historical cash/cheque/etc.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_check,
  ALTER COLUMN provider SET DEFAULT 'stripe';
UPDATE public.payments SET provider = 'stripe' WHERE provider IS NULL;
UPDATE public.payments SET provider = 'interac' WHERE provider = 'etransfer';
UPDATE public.payments
SET manual_review_status = CASE
      WHEN status = 'pending' THEN 'submitted'
      WHEN status IN ('succeeded', 'partially_refunded', 'refunded') THEN 'confirmed'
      WHEN status = 'failed' THEN 'rejected'
      WHEN status = 'canceled' THEN 'cancelled'
      ELSE NULL
    END,
    manual_submitted_at = COALESCE(manual_submitted_at, created_at),
    manual_confirmed_at = CASE
      WHEN status IN ('succeeded', 'partially_refunded', 'refunded') THEN COALESCE(manual_confirmed_at, succeeded_at, created_at)
      ELSE manual_confirmed_at END,
    manual_rejected_at = CASE WHEN status = 'failed' THEN COALESCE(manual_rejected_at, failed_at, updated_at) ELSE manual_rejected_at END
WHERE provider = 'interac' AND manual_review_status IS NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_check,
  DROP CONSTRAINT IF EXISTS payments_manual_review_status_check,
  DROP CONSTRAINT IF EXISTS payments_manual_review_state_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_check
    CHECK (provider IN ('stripe', 'interac', 'paypal', 'cash', 'cheque', 'other')),
  ADD CONSTRAINT payments_manual_review_status_check
    CHECK (manual_review_status IS NULL OR manual_review_status IN ('submitted', 'investigating', 'confirmed', 'rejected', 'cancelled')),
  ADD CONSTRAINT payments_manual_review_state_check CHECK (
    (provider <> 'interac' AND manual_review_status IS NULL)
    OR (provider = 'interac' AND (
      (manual_review_status IN ('submitted', 'investigating') AND status = 'pending')
      OR (manual_review_status = 'confirmed' AND status IN ('succeeded', 'partially_refunded', 'refunded'))
      OR (manual_review_status = 'rejected' AND status = 'failed')
      OR (manual_review_status = 'cancelled' AND status = 'canceled')
    ))
  );

ALTER TABLE public.payments ALTER COLUMN provider SET NOT NULL;
CREATE INDEX IF NOT EXISTS payments_manual_review_idx
  ON public.payments(manual_review_status, created_at DESC)
  WHERE provider = 'interac';

CREATE TABLE IF NOT EXISTS public.payment_manual_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note_type text NOT NULL CHECK (note_type IN ('internal', 'rejection')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_manual_review_notes_payment_idx
  ON public.payment_manual_review_notes(payment_id, created_at DESC);
ALTER TABLE public.payment_manual_review_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read manual payment review notes" ON public.payment_manual_review_notes;
CREATE POLICY "Admins read manual payment review notes" ON public.payment_manual_review_notes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin' AND p.application_status = 'approved')
  );
REVOKE ALL ON public.payment_manual_review_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_manual_review_notes TO authenticated;
GRANT ALL ON public.payment_manual_review_notes TO service_role;

-- Fulfillment validates the actual configured price and record ownership before
-- activating benefits. Any exception rolls back the payment status change too.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
  v_expected_amount bigint;
  v_family_member boolean;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF v_payment.status NOT IN ('succeeded', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only successful, not-fully-refunded payments can be fulfilled';
  END IF;
  IF lower(v_payment.currency) <> 'cad' THEN RAISE EXCEPTION 'PCTC payments must be in CAD'; END IF;

  IF v_payment.purpose = 'membership' THEN
    SELECT COALESCE(single_price_cents, 0) INTO v_expected_amount
    FROM public.membership_plan_settings WHERE id = 1;
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid family reference on payment';
      END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      SELECT COALESCE(family_price_cents, 0) INTO v_expected_amount
      FROM public.membership_plan_settings WHERE id = 1;
      IF NOT EXISTS (SELECT 1 FROM public.membership_families f WHERE f.id = v_family_id) THEN
        RAISE EXCEPTION 'Family membership record was not found';
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM public.membership_family_members fm
        WHERE fm.family_id = v_family_id AND fm.user_id = v_payment.user_id
          AND fm.status = 'confirmed'
      ) INTO v_family_member;
      IF NOT v_family_member THEN RAISE EXCEPTION 'Payer is not a confirmed member of this family'; END IF;
      IF v_expected_amount IS NULL OR v_expected_amount <= 0 OR v_payment.amount_minor <> v_expected_amount THEN
        RAISE EXCEPTION 'Payment amount does not match the configured family membership price';
      END IF;
      UPDATE public.membership_families
      SET paid_at = COALESCE(paid_at, now()),
          paid_by = COALESCE(paid_by, v_payment.user_id),
          payment_id = COALESCE(payment_id, v_payment.id)
      WHERE id = v_family_id AND (payment_id IS NULL OR payment_id = v_payment.id);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
      IF EXISTS (SELECT 1 FROM public.membership_families WHERE id = v_family_id AND payment_id = v_payment.id AND paid_at IS NOT NULL) THEN RETURN; END IF;
      RAISE EXCEPTION 'Family membership was already paid by a different payment';
    END IF;

    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid membership reference on payment';
    END IF;
    v_membership_id := v_payment.business_record_id::uuid;
    IF v_expected_amount IS NULL OR v_expected_amount <= 0 OR v_payment.amount_minor <> v_expected_amount THEN
      RAISE EXCEPTION 'Payment amount does not match the configured individual membership price';
    END IF;
    UPDATE public.memberships
    SET status = 'active', payment_status = 'paid', updated_at = now()
    WHERE id = v_membership_id AND user_id = v_payment.user_id
      AND lower(membership_type) NOT LIKE '%family%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.memberships WHERE id = v_membership_id AND user_id = v_payment.user_id AND status = 'active' AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Membership record was not found, does not belong to the payer, or is not an individual membership';

  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid registration reference on payment';
    END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r
    SET payment_status = 'paid',
        payment_provider = v_payment.provider,
        provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id, 'payment:' || v_payment.id::text),
        updated_at = now()
    FROM public.events e
    WHERE r.id = v_registration_id AND r.event_id = e.id
      AND r.user_id = v_payment.user_id AND r.status = 'confirmed'
      AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor
      AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid' AND status = 'confirmed') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Derive the actor from auth.uid() rather than trusting an actor ID supplied by
-- the browser. Call this RPC with the authenticated user's Supabase client.
CREATE OR REPLACE FUNCTION public.review_manual_payment(
  p_payment_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_note text := NULLIF(btrim(p_note), '');
  v_now timestamptz := now();
  v_duplicate boolean := false;
  v_note_type text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject', 'investigate') THEN RAISE EXCEPTION 'Unsupported manual payment action'; END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'A reason is required to reject a manual payment'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Manual review notes must be 1,000 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'interac' THEN RAISE EXCEPTION 'Only Interac payments can be reviewed manually'; END IF;
  IF v_payment.user_id = v_actor THEN RAISE EXCEPTION 'Administrators cannot review their own payments'; END IF;

  IF p_action = 'confirm' AND v_payment.status IN ('succeeded', 'partially_refunded', 'refunded') AND v_payment.manual_review_status = 'confirmed' THEN
    v_duplicate := true;
  ELSIF p_action = 'reject' AND v_payment.status = 'failed' AND v_payment.manual_review_status = 'rejected' THEN
    v_duplicate := true;
  ELSE
    IF v_payment.status <> 'pending' OR (v_payment.manual_review_status IS DISTINCT FROM 'submitted' AND v_payment.manual_review_status IS DISTINCT FROM 'investigating') THEN
      RAISE EXCEPTION 'This manual payment is no longer awaiting review';
    END IF;

    IF p_action = 'investigate' THEN
      UPDATE public.payments SET manual_review_status = 'investigating', updated_at = v_now WHERE id = p_payment_id;
      v_note_type := 'internal';
    ELSIF p_action = 'confirm' THEN
      UPDATE public.payments SET status = 'succeeded', succeeded_at = v_now,
        manual_review_status = 'confirmed', manual_confirmed_at = v_now, manual_confirmed_by = v_actor,
        failure_code = NULL, failure_message = NULL, updated_at = v_now
      WHERE id = p_payment_id;
      -- If fulfillment validation fails, PostgreSQL rolls back this entire function call.
      PERFORM public.fulfill_successful_payment(p_payment_id);
      v_note_type := 'internal';
    ELSE
      UPDATE public.payments SET status = 'failed', failed_at = v_now,
        failure_code = 'manual_rejected', failure_message = left(v_note, 1000),
        manual_review_status = 'rejected', manual_rejected_at = v_now, manual_rejected_by = v_actor,
        updated_at = v_now WHERE id = p_payment_id;
      -- Keep the associated record unpaid and explicitly expose failure where supported.
      IF v_payment.purpose = 'event_registration' THEN
        UPDATE public.registrations SET payment_status = 'failed', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id
          AND status = 'confirmed' AND payment_status IN ('pending', 'failed');
      ELSIF v_payment.purpose = 'membership' AND v_payment.business_record_id !~ '^family:' THEN
        UPDATE public.memberships SET payment_status = 'unpaid', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id AND status <> 'active';
      END IF;
      v_note_type := 'rejection';
    END IF;

    IF v_note IS NOT NULL THEN
      INSERT INTO public.payment_manual_review_notes(payment_id, actor_user_id, note_type, note)
      VALUES (p_payment_id, v_actor, v_note_type, left(v_note, 1000));
    END IF;

    INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, source, summary, changes)
    VALUES (v_actor, 'admin', 'payment.manual_' || p_action, 'success', 'payments', p_payment_id::text,
      'manual_payment_review',
      CASE p_action WHEN 'confirm' THEN 'Manual Interac payment confirmed.' WHEN 'reject' THEN 'Manual Interac payment rejected.' ELSE 'Manual Interac payment marked for investigation.' END,
      jsonb_build_object('provider', v_payment.provider, 'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id));
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'userId', v_payment.user_id,
    'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id,
    'amountMinor', v_payment.amount_minor, 'currency', v_payment.currency,
    'status', v_payment.status, 'manualReviewStatus', v_payment.manual_review_status, 'duplicate', v_duplicate);
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text, text) TO authenticated;

-- Preserve the existing event-registration rules; only correct provider reuse for prior paid registrations.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_prior_payment public.payments%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.';
  END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position), 0) + 1 INTO v_queue FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;
  -- Reuse a prior successful, never-refunded payment when the same member
  -- withdraws and later registers for this same event at the same price.
  -- A waitlisted registration is not marked paid until it has a confirmed place.
  IF v_event.price_cents > 0 AND v_status = 'confirmed' THEN
    SELECT p.* INTO v_prior_payment
    FROM public.payments p
    JOIN public.registrations previous_registration
      ON previous_registration.id::text = p.business_record_id
    WHERE p.user_id = v_user
      AND p.purpose = 'event_registration'
      AND p.status = 'succeeded'
      AND COALESCE(p.refunded_amount_minor, 0) = 0
      AND p.amount_minor = v_event.price_cents
      AND previous_registration.event_id = p_event_id
      AND previous_registration.user_id = v_user
      AND previous_registration.status = 'cancelled'
    ORDER BY p.succeeded_at DESC NULLS LAST, p.created_at DESC
    LIMIT 1;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(
    event_id, user_id, status, queue_position, amount_cents, payment_status,
    payment_provider, provider_reference
  )
  VALUES (
    p_event_id, v_user, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required'
         WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN 'paid'
         ELSE 'pending' END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN COALESCE(v_prior_payment.provider, 'stripe') ELSE NULL END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL
         THEN COALESCE(v_prior_payment.stripe_payment_intent_id, v_prior_payment.stripe_checkout_session_id, 'payment:' || v_prior_payment.id::text)
         ELSE NULL END
  )
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);
  PERFORM public.record_business_audit_event(
    'event.registration.created', 'Added ' || coalesce(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'new_queue_position', v_queue
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'queue_position', v_queue),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, text) TO authenticated;



-- Configurable instructions displayed to members when they choose Interac e-Transfer.
CREATE TABLE IF NOT EXISTS public.payment_method_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  interac_enabled boolean NOT NULL DEFAULT false,
  interac_recipient_email text NOT NULL DEFAULT '',
  interac_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT payment_method_settings_email_length CHECK (length(interac_recipient_email) <= 254),
  CONSTRAINT payment_method_settings_instructions_length CHECK (length(interac_instructions) <= 5000)
);
INSERT INTO public.payment_method_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.payment_method_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage payment method settings" ON public.payment_method_settings;
CREATE POLICY "Admins manage payment method settings" ON public.payment_method_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.application_status = 'approved'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members read enabled Interac settings" ON public.payment_method_settings;
CREATE POLICY "Members read enabled Interac settings" ON public.payment_method_settings FOR SELECT TO authenticated USING (interac_enabled = true);
GRANT SELECT, INSERT, UPDATE ON public.payment_method_settings TO authenticated;
GRANT ALL ON public.payment_method_settings TO service_role;

-- Migration 0047: manual Interac refund recording and review policy updates.
-- Refunds are accounting records only; no payment processor or bank transfer is initiated.

CREATE TABLE IF NOT EXISTS public.manual_payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  note text,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_payment_refunds_payment_idx ON public.manual_payment_refunds(payment_id, created_at DESC);
ALTER TABLE public.manual_payment_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read own manual payment refunds" ON public.manual_payment_refunds;
CREATE POLICY "Members read own manual payment refunds" ON public.manual_payment_refunds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND p.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Admins read manual payment refunds" ON public.manual_payment_refunds;
CREATE POLICY "Admins read manual payment refunds" ON public.manual_payment_refunds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.application_status = 'approved'));
REVOKE ALL ON public.manual_payment_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.manual_payment_refunds TO authenticated;
GRANT ALL ON public.manual_payment_refunds TO service_role;

CREATE OR REPLACE FUNCTION public.record_manual_interac_refund(
  p_payment_id uuid, p_amount_minor bigint, p_note text DEFAULT NULL, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_existing public.manual_payment_refunds%rowtype;
  v_refund public.manual_payment_refunds%rowtype;
  v_total bigint;
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'A refund idempotency key is required'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'Refund note must be 500 characters or fewer'; END IF;

  SELECT * INTO v_existing FROM public.manual_payment_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payment_id <> p_payment_id THEN RAISE EXCEPTION 'Refund idempotency key has already been used'; END IF;
    RETURN jsonb_build_object('refundId', v_existing.id, 'paymentId', v_existing.payment_id,
      'amountMinor', v_existing.amount_minor, 'currency', v_existing.currency, 'duplicate', true);
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  -- Recheck after acquiring the payment lock so a retried request is idempotent.
  SELECT * INTO v_existing FROM public.manual_payment_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payment_id <> p_payment_id THEN RAISE EXCEPTION 'Refund idempotency key has already been used'; END IF;
    RETURN jsonb_build_object('refundId', v_existing.id, 'paymentId', v_existing.payment_id,
      'amountMinor', v_existing.amount_minor, 'currency', v_existing.currency, 'duplicate', true);
  END IF;
  IF v_payment.provider <> 'interac' OR v_payment.manual_review_status <> 'confirmed' OR v_payment.status NOT IN ('succeeded', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only confirmed Interac payments can be refunded';
  END IF;
  IF p_amount_minor > v_payment.amount_minor - v_payment.refunded_amount_minor THEN
    RAISE EXCEPTION 'Refund amount exceeds the remaining refundable balance';
  END IF;

  INSERT INTO public.manual_payment_refunds(payment_id, amount_minor, currency, note, idempotency_key, actor_user_id)
  VALUES (p_payment_id, p_amount_minor, lower(v_payment.currency), NULLIF(btrim(p_note), ''), p_idempotency_key, v_actor)
  RETURNING * INTO v_refund;
  v_total := v_payment.refunded_amount_minor + p_amount_minor;
  UPDATE public.payments SET refunded_amount_minor = v_total,
    status = CASE WHEN v_total = amount_minor THEN 'refunded' ELSE 'partially_refunded' END,
    updated_at = v_now WHERE id = p_payment_id;
  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, source, summary, changes, idempotency_key)
  VALUES (v_actor, 'admin', 'payment.manual_refund_recorded', 'success', 'payments', p_payment_id::text,
    'admin_manual_payment_refund', 'Manual Interac refund recorded.',
    jsonb_build_object('refundId', v_refund.id, 'amountMinor', p_amount_minor, 'currency', lower(v_payment.currency), 'note', NULLIF(btrim(p_note), '')),
    'payment:manual-refund:' || p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('refundId', v_refund.id, 'paymentId', p_payment_id,
    'amountMinor', p_amount_minor, 'currency', lower(v_payment.currency), 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_interac_refund(uuid, bigint, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_manual_interac_refund(uuid, bigint, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_manual_payment(
  p_payment_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_note text := NULLIF(btrim(p_note), '');
  v_now timestamptz := now();
  v_duplicate boolean := false;
  v_note_type text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN RAISE EXCEPTION 'Unsupported manual payment action'; END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'A reason is required to reject a manual payment'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Manual review notes must be 1,000 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'interac' THEN RAISE EXCEPTION 'Only Interac payments can be reviewed manually'; END IF;
  IF v_payment.user_id = v_actor AND p_action <> 'confirm' THEN RAISE EXCEPTION 'Administrators may only confirm their own payments'; END IF;

  IF p_action = 'confirm' AND v_payment.status IN ('succeeded', 'partially_refunded', 'refunded') AND v_payment.manual_review_status = 'confirmed' THEN
    v_duplicate := true;
  ELSIF p_action = 'reject' AND v_payment.status = 'failed' AND v_payment.manual_review_status = 'rejected' THEN
    v_duplicate := true;
  ELSE
    IF v_payment.status <> 'pending' OR (v_payment.manual_review_status IS DISTINCT FROM 'submitted' AND v_payment.manual_review_status IS DISTINCT FROM 'investigating') THEN
      RAISE EXCEPTION 'This manual payment is no longer awaiting review';
    END IF;

    IF p_action = 'confirm' THEN
      UPDATE public.payments SET status = 'succeeded', succeeded_at = v_now,
        manual_review_status = 'confirmed', manual_confirmed_at = v_now, manual_confirmed_by = v_actor,
        failure_code = NULL, failure_message = NULL, updated_at = v_now
      WHERE id = p_payment_id;
      -- If fulfillment validation fails, PostgreSQL rolls back this entire function call.
      PERFORM public.fulfill_successful_payment(p_payment_id);
      v_note_type := 'internal';
    ELSE
      UPDATE public.payments SET status = 'failed', failed_at = v_now,
        failure_code = 'manual_rejected', failure_message = left(v_note, 1000),
        manual_review_status = 'rejected', manual_rejected_at = v_now, manual_rejected_by = v_actor,
        updated_at = v_now WHERE id = p_payment_id;
      -- Keep the associated record unpaid and explicitly expose failure where supported.
      IF v_payment.purpose = 'event_registration' THEN
        UPDATE public.registrations SET payment_status = 'failed', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id
          AND status = 'confirmed' AND payment_status IN ('pending', 'failed');
      ELSIF v_payment.purpose = 'membership' AND v_payment.business_record_id !~ '^family:' THEN
        UPDATE public.memberships SET payment_status = 'unpaid', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id AND status <> 'active';
      END IF;
      v_note_type := 'rejection';
    END IF;

    IF v_note IS NOT NULL THEN
      INSERT INTO public.payment_manual_review_notes(payment_id, actor_user_id, note_type, note)
      VALUES (p_payment_id, v_actor, v_note_type, left(v_note, 1000));
    END IF;

    INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, source, summary, changes)
    VALUES (v_actor, 'admin', 'payment.manual_' || p_action, 'success', 'payments', p_payment_id::text,
      'manual_payment_review',
      CASE p_action WHEN 'confirm' THEN 'Manual Interac payment confirmed.' ELSE 'Manual Interac payment rejected.' END,
      jsonb_build_object('provider', v_payment.provider, 'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id));
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'userId', v_payment.user_id,
    'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id,
    'amountMinor', v_payment.amount_minor, 'currency', v_payment.currency,
    'status', v_payment.status, 'manualReviewStatus', v_payment.manual_review_status, 'duplicate', v_duplicate);
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text, text) TO authenticated;

-- Tournament configuration, roster, team, draw, match, scoring and audit data.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('male','female','other','prefer_not_to_say'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tournament_format text CHECK (tournament_format IN ('doubles','team')),
  ADD COLUMN IF NOT EXISTS tournament_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tournament_rules_html text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allow_non_member_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_details_public boolean NOT NULL DEFAULT true;

UPDATE public.events SET tournament_format='doubles' WHERE event_type='tournament' AND tournament_format IS NULL;

CREATE OR REPLACE FUNCTION public.event_tournament_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, email text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())) THEN
   RAISE EXCEPTION 'Tournament manager access required';
 END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.email,p.gender FROM public.profiles p ORDER BY p.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_member_directory(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.tournament_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  logo_url text,
  color text NOT NULL DEFAULT '' CHECK (length(color) <= 80),
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  captain_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, name),
  UNIQUE(event_id, id)
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'team' CHECK (category IN ('mixed','men','women','team')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('not_required','pending','paid','refunded','failed')),
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  email text,
  phone text,
  gender text CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  gender_override text CHECK (gender_override IN ('male','female','other','prefer_not_to_say')),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','withdrawn','replaced')),
  replaced_by uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_participants_event_idx ON public.tournament_participants(event_id, status);
CREATE INDEX IF NOT EXISTS tournament_participants_team_idx ON public.tournament_participants(team_id);
-- A member may have separate registrations in mixed and their gender category.
CREATE INDEX IF NOT EXISTS tournament_participants_member_event_idx ON public.tournament_participants(event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_member_category_idx ON public.tournament_participants(event_id,user_id,category) WHERE user_id IS NOT NULL AND status='registered';

CREATE TABLE IF NOT EXISTS public.tournament_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('mixed','men','women')),
  player_one_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  player_two_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  seed integer CHECK (seed IS NULL OR seed > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_id <> player_two_id),
  UNIQUE(event_id, id),
  UNIQUE(event_id, category, player_one_id, player_two_id)
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'team' CHECK (category IN ('mixed','men','women','team')),
  phase text NOT NULL CHECK (phase IN ('preliminary_knockout','round_robin','final_knockout','team_round_robin','team_knockout')),
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  match_number integer NOT NULL DEFAULT 1 CHECK (match_number > 0),
  pair_one_id uuid REFERENCES public.tournament_pairs(id) ON DELETE SET NULL,
  pair_two_id uuid REFERENCES public.tournament_pairs(id) ON DELETE SET NULL,
  team_one_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  team_two_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  court_number integer CHECK (court_number IS NULL OR court_number BETWEEN 1 AND 4),
  score_sets jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_side smallint CHECK (winner_side IN (1,2)),
  team_points_one integer NOT NULL DEFAULT 0 CHECK (team_points_one >= 0),
  team_points_two integer NOT NULL DEFAULT 0 CHECK (team_points_two >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled','bye')),
  notes text NOT NULL DEFAULT '',
  entered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pair_one_id IS NULL OR pair_two_id IS NULL OR pair_one_id <> pair_two_id),
  CHECK (team_one_id IS NULL OR team_two_id IS NULL OR team_one_id <> team_two_id)
);
CREATE INDEX IF NOT EXISTS tournament_matches_schedule_idx ON public.tournament_matches(event_id, scheduled_at, court_number);
CREATE INDEX IF NOT EXISTS tournament_matches_phase_idx ON public.tournament_matches(event_id, category, phase, group_number, round_number, match_number);

CREATE TABLE IF NOT EXISTS public.tournament_match_players (
  match_id uuid NOT NULL REFERENCES public.tournament_matches(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  side smallint NOT NULL CHECK (side IN (1,2)),
  team_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.tournament_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_audit_event_idx ON public.tournament_audit_log(event_id, created_at DESC);

-- Public views deliberately expose names and competition data only, never private contact/payment fields.
CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id, t.event_id, t.name, t.logo_url, t.color, t.group_number, t.captain_user_id, p.full_name AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles p ON p.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND e.tournament_details_public=true;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name, p.gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND e.tournament_details_public=true AND p.status='registered';

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND e.tournament_details_public=true;

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id, m.event_id, m.category, m.phase, m.group_number, m.round_number, m.match_number,
       m.pair_one_id, m.pair_two_id, m.team_one_id, m.team_two_id, m.scheduled_at, m.court_number,
       m.score_sets, m.winner_side, m.team_points_one, m.team_points_two, m.status, m.notes,
       p1.name AS team_one_name, p2.name AS team_two_name,
       coalesce(side_one.players, a.player_one_name || ' + ' || a.player_two_name) AS player_one_name,
       NULL::text AS player_two_name,
       coalesce(side_two.players, b.player_one_name || ' + ' || b.player_two_name) AS opponent_one_name,
       NULL::text AS opponent_two_name
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published' AND e.tournament_details_public=true
LEFT JOIN public.tournament_teams p1 ON p1.id=m.team_one_id
LEFT JOIN public.tournament_teams p2 ON p2.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs a ON a.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs b ON b.id=m.pair_two_id
LEFT JOIN LATERAL (
 SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=1
) side_one ON true
LEFT JOIN LATERAL (
 SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=2
) side_two ON true;

CREATE OR REPLACE VIEW public.tournament_ranked_sets AS
SELECT m.id::text || ':' || set_data.set_no::text AS id,
       m.event_id, CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at <= now() THEN m.scheduled_at ELSE m.updated_at END AS played_at,
       (side_one.users)[1] AS player_one_user_id, (side_one.users)[2] AS player_two_user_id,
       (side_two.users)[1] AS player_three_user_id, (side_two.users)[2] AS player_four_user_id,
       (set_data.set_score->>'one')::integer AS player_one_score,
       (set_data.set_score->>'two')::integer AS player_two_score
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.event_type='tournament'
CROSS JOIN LATERAL jsonb_array_elements(m.score_sets) WITH ORDINALITY AS set_data(set_score,set_no)
LEFT JOIN LATERAL (
 SELECT array_agg(p.user_id ORDER BY p.display_name) FILTER (WHERE p.user_id IS NOT NULL) AS users
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=1
) side_one ON true
LEFT JOIN LATERAL (
 SELECT array_agg(p.user_id ORDER BY p.display_name) FILTER (WHERE p.user_id IS NOT NULL) AS users
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=2
) side_two ON true
WHERE m.status='completed' AND jsonb_typeof(m.score_sets)='array';
REVOKE ALL ON public.tournament_ranked_sets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_ranked_sets TO service_role;

ALTER TABLE public.tournament_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tournament managers manage teams" ON public.tournament_teams;
CREATE POLICY "Tournament managers manage teams" ON public.tournament_teams FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage participants" ON public.tournament_participants;
CREATE POLICY "Tournament managers manage participants" ON public.tournament_participants FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage pairs" ON public.tournament_pairs;
CREATE POLICY "Tournament managers manage pairs" ON public.tournament_pairs FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage matches" ON public.tournament_matches;
CREATE POLICY "Tournament managers manage matches" ON public.tournament_matches FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Captains edit their team matches" ON public.tournament_matches;
CREATE POLICY "Captains edit their team matches" ON public.tournament_matches FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.tournament_teams t JOIN public.profiles p ON p.id=t.captain_user_id WHERE p.id=auth.uid() AND (t.id=team_one_id OR t.id=team_two_id) AND t.event_id=tournament_matches.event_id))
 WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_teams t JOIN public.profiles p ON p.id=t.captain_user_id WHERE p.id=auth.uid() AND (t.id=team_one_id OR t.id=team_two_id) AND t.event_id=tournament_matches.event_id));
DROP POLICY IF EXISTS "Tournament managers manage match players" ON public.tournament_match_players;
CREATE POLICY "Tournament managers manage match players" ON public.tournament_match_players FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Members read own tournament participant row" ON public.tournament_participants;
CREATE POLICY "Members read own tournament participant row" ON public.tournament_participants FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "Public read published tournament match players" ON public.tournament_match_players;
CREATE POLICY "Public read published tournament match players" ON public.tournament_match_players FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND e.status='published' AND e.tournament_details_public=true));
DROP POLICY IF EXISTS "Captains manage their match pairings" ON public.tournament_match_players;
CREATE POLICY "Captains manage their match pairings" ON public.tournament_match_players FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.tournament_teams t ON t.id=tournament_match_players.team_id WHERE m.id=match_id AND t.captain_user_id=auth.uid() AND t.event_id=m.event_id AND t.id=CASE WHEN side=1 THEN m.team_one_id ELSE m.team_two_id END AND m.status NOT IN ('completed','cancelled')))
 WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.tournament_teams t ON t.id=tournament_match_players.team_id JOIN public.tournament_participants p ON p.id=participant_id WHERE m.id=match_id AND t.captain_user_id=auth.uid() AND t.event_id=m.event_id AND t.id=CASE WHEN side=1 THEN m.team_one_id ELSE m.team_two_id END AND p.team_id=t.id AND m.status NOT IN ('completed','cancelled')));
DROP POLICY IF EXISTS "Tournament managers read audit log" ON public.tournament_audit_log;
CREATE POLICY "Tournament managers read audit log" ON public.tournament_audit_log FOR SELECT TO authenticated USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers write audit log" ON public.tournament_audit_log;
CREATE POLICY "Tournament managers write audit log" ON public.tournament_audit_log FOR INSERT TO authenticated WITH CHECK (actor_user_id=auth.uid() AND public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_teams, public.tournament_participants, public.tournament_pairs, public.tournament_matches, public.tournament_match_players TO authenticated;
GRANT SELECT ON public.tournament_public_teams, public.tournament_public_participants, public.tournament_public_pairs, public.tournament_public_matches TO anon, authenticated;
GRANT SELECT, INSERT ON public.tournament_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text DEFAULT NULL, p_email text DEFAULT NULL,
 p_phone text DEFAULT NULL, p_gender text DEFAULT NULL, p_partner_participant_id uuid DEFAULT NULL,
 p_partner_name text DEFAULT NULL, p_partner_email text DEFAULT NULL, p_partner_phone text DEFAULT NULL,
 p_partner_gender text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := auth.uid(); v_event public.events%rowtype; v_profile public.profiles%rowtype;
 v_config jsonb; v_mode text; v_gender text; v_partner_gender text; v_participant_id uuid; v_partner_id uuid;
 v_pair_id uuid; v_amount integer; v_count integer;
BEGIN
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
 IF NOT FOUND OR v_event.event_type<>'tournament' OR v_event.status<>'published' THEN RAISE EXCEPTION 'Tournament registration is unavailable'; END IF;
 IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
   RAISE EXCEPTION 'Tournament registration is closed';
 END IF;
 IF p_category NOT IN ('mixed','men','women','team') THEN RAISE EXCEPTION 'Invalid tournament category'; END IF;
 v_config := coalesce(v_event.tournament_config,'{}'::jsonb);
 v_mode := coalesce(v_config->>'registration_mode','both');
 IF v_event.tournament_format='team' THEN
   IF p_category<>'team' THEN RAISE EXCEPTION 'Team tournaments register participants for team assignment'; END IF;
 ELSE
   IF p_category='team' OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN RAISE EXCEPTION 'This doubles category is not enabled'; END IF;
 END IF;
 IF p_partner_participant_id IS NOT NULL OR nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF v_event.tournament_format<>'doubles' OR v_mode='single' THEN RAISE EXCEPTION 'This tournament accepts individual registration only'; END IF;
 ELSIF v_event.tournament_format='doubles' AND v_mode='doubles' THEN
   RAISE EXCEPTION 'Register with a partner for this tournament';
 END IF;
 IF v_user IS NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Sign in to register for this tournament'; END IF;
   IF nullif(btrim(p_display_name),'') IS NULL OR nullif(btrim(p_email),'') IS NULL THEN RAISE EXCEPTION 'Name and email are required for non-member registration'; END IF;
   IF length(btrim(p_display_name))>160 OR length(btrim(p_email))>254 THEN RAISE EXCEPTION 'Participant details are too long'; END IF;
   v_gender := p_gender;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'This email is already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='women' AND status='registered')) OR (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='men' AND status='registered')) THEN RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles'; END IF;
 ELSE
   SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
   IF NOT FOUND OR v_profile.application_status<>'approved' THEN RAISE EXCEPTION 'An approved member profile is required'; END IF;
   v_gender := v_profile.gender;
   SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND status='registered';
   IF v_event.tournament_format='team' AND v_count>=1 THEN RAISE EXCEPTION 'You are already registered for this team tournament'; END IF;
   IF v_event.tournament_format='doubles' AND v_count>=2 THEN RAISE EXCEPTION 'A player may enter no more than two doubles categories'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'You are already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='women' AND status='registered')) OR
      (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='men' AND status='registered')) THEN
     RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
   END IF;
 END IF;
 IF p_category='men' AND v_gender='female' THEN RAISE EXCEPTION 'The profile gender is not eligible for men''s doubles'; END IF;
 IF p_category='women' AND v_gender='male' THEN RAISE EXCEPTION 'The profile gender is not eligible for women''s doubles'; END IF;
 IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender value'; END IF;
 v_amount := v_event.price_cents;
 INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
 VALUES(p_event_id,v_user,p_category,CASE WHEN v_user IS NOT NULL THEN coalesce(nullif(v_profile.full_name,''),v_profile.email) ELSE btrim(p_display_name) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.email ELSE lower(btrim(p_email)) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.phone ELSE nullif(btrim(p_phone),'') END,
        v_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
 RETURNING id INTO v_participant_id;
 IF p_partner_participant_id IS NOT NULL THEN
   SELECT coalesce(gender_override,gender) INTO v_partner_gender FROM public.tournament_participants
   WHERE id=p_partner_participant_id AND event_id=p_event_id AND category=p_category AND status='registered';
   IF NOT FOUND THEN RAISE EXCEPTION 'The selected partner is not registered in this category'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_pairs WHERE event_id=p_event_id AND category=p_category AND (player_one_id=p_partner_participant_id OR player_two_id=p_partner_participant_id)) THEN RAISE EXCEPTION 'The selected partner is already paired in this category'; END IF;
   v_partner_id := p_partner_participant_id;
 ELSIF nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Register the partner as a member first, or ask the organizer to enable non-member registration'; END IF;
   IF nullif(btrim(p_partner_email),'') IS NULL THEN RAISE EXCEPTION 'Partner email is required'; END IF;
   IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender value'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_partner_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'Partner email is already registered in this category'; END IF;
   IF p_category='men' AND p_partner_gender='female' THEN RAISE EXCEPTION 'The partner profile gender is not eligible for men''s doubles'; END IF;
   IF p_category='women' AND p_partner_gender='male' THEN RAISE EXCEPTION 'The partner profile gender is not eligible for women''s doubles'; END IF;
   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender='female' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender='male' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;
 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;

-- Individual event scores remain unavailable for all tournament events, including direct API calls.
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated WITH CHECK (
 entered_by=auth.uid() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.event_type<>'tournament')
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=auth.uid() AND r.status='confirmed' AND r.event_id=event_scores.event_id)
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')
 AND (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
);

-- Score and schedule edits are audited, including manager corrections after a match is played.
CREATE OR REPLACE FUNCTION public.audit_tournament_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
 v_event_id := CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP<>'INSERT' THEN v_before := to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN v_after := to_jsonb(NEW); END IF;
 INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(v_event_id,v_actor,lower(TG_OP),TG_TABLE_NAME,v_id,v_before,v_after);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_tournament_matches ON public.tournament_matches;
CREATE TRIGGER audit_tournament_matches AFTER INSERT OR UPDATE OR DELETE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_teams ON public.tournament_teams;
CREATE TRIGGER audit_tournament_teams AFTER INSERT OR UPDATE OR DELETE ON public.tournament_teams FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_participants ON public.tournament_participants;
CREATE TRIGGER audit_tournament_participants AFTER INSERT OR UPDATE OR DELETE ON public.tournament_participants FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_pairs ON public.tournament_pairs;
CREATE TRIGGER audit_tournament_pairs AFTER INSERT OR UPDATE OR DELETE ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();

CREATE OR REPLACE FUNCTION public.guard_captain_tournament_score_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_is_captain boolean;
BEGIN
 SELECT EXISTS (SELECT 1 FROM public.tournament_teams t WHERE t.event_id=OLD.event_id AND t.captain_user_id=auth.uid() AND (t.id=OLD.team_one_id OR t.id=OLD.team_two_id)) INTO v_is_captain;
 IF v_is_captain AND NOT public.is_event_manager() THEN
   IF (to_jsonb(NEW) - ARRAY['score_sets','winner_side','team_points_one','team_points_two','status','entered_by','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['score_sets','winner_side','team_points_one','team_points_two','status','entered_by','updated_at']) THEN
     RAISE EXCEPTION 'Team captains may edit match results only';
   END IF;
   NEW.entered_by := auth.uid();
   NEW.updated_at := now();
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_captain_tournament_score_edit ON public.tournament_matches;
CREATE TRIGGER guard_captain_tournament_score_edit BEFORE UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.guard_captain_tournament_score_edit();

-- Allow a single authenticated participant to pay for one or two tournament entries.
ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_tournament_participant_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_count integer;
BEGIN
  IF public.is_event_manager() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text)::bigint);
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_event.event_type <> 'tournament' OR v_event.status <> 'published' OR now() < v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at) OR now() >= v_event.starts_at THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF auth.uid() IS NULL THEN
    IF NOT v_event.allow_non_member_registration OR NEW.user_id IS NOT NULL THEN RAISE EXCEPTION 'Non-member registration is not enabled'; END IF;
  ELSE
    IF NEW.user_id = auth.uid() THEN
      IF v_event.members_only AND NOT public.current_user_has_active_paid_membership() THEN RAISE EXCEPTION 'An active paid membership is required for this tournament'; END IF;
    ELSIF NEW.user_id IS NULL AND NOT v_event.allow_non_member_registration THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id = NEW.event_id AND status = 'registered';
  IF v_count >= v_event.capacity THEN RAISE EXCEPTION 'Tournament registration is full'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_tournament_participant_registration ON public.tournament_participants;
CREATE TRIGGER guard_tournament_participant_registration BEFORE INSERT ON public.tournament_participants FOR EACH ROW EXECUTE FUNCTION public.guard_tournament_participant_registration();

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_purpose_check
  CHECK (purpose IN ('membership', 'event_registration', 'tournament_registration', 'other'));


CREATE OR REPLACE FUNCTION public.audit_tournament_match_player_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_match_id uuid; v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_participant uuid;
BEGIN
  v_match_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  v_participant := CASE WHEN TG_OP = 'DELETE' THEN OLD.participant_id ELSE NEW.participant_id END;
  SELECT event_id INTO v_event_id FROM public.tournament_matches WHERE id = v_match_id;
  IF v_event_id IS NULL AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'Tournament match was not found for pairing audit'; END IF;
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after := to_jsonb(NEW); END IF;
  INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(v_event_id,v_actor,lower(TG_OP),'tournament_match_players',v_participant,v_before,v_after);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_tournament_match_players ON public.tournament_match_players;
CREATE TRIGGER audit_tournament_match_players AFTER INSERT OR UPDATE OR DELETE ON public.tournament_match_players FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_match_player_change();


-- Published competition details are public when enabled; when disabled, registered tournament members can still see competition information.
CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id, t.event_id, t.name, t.logo_url, t.color, t.group_number, t.captain_user_id, p.full_name AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles p ON p.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name, p.gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND p.status='registered' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id, m.event_id, m.category, m.phase, m.group_number, m.round_number, m.match_number,
       m.pair_one_id, m.pair_two_id, m.team_one_id, m.team_two_id, m.scheduled_at, m.court_number,
       m.score_sets, m.winner_side, m.team_points_one, m.team_points_two, m.status, m.notes,
       p1.name AS team_one_name, p2.name AS team_two_name,
       coalesce(side_one.players, a.player_one_name || ' + ' || a.player_two_name) AS player_one_name,
       NULL::text AS player_two_name,
       coalesce(side_two.players, b.player_one_name || ' + ' || b.player_two_name) AS opponent_one_name,
       NULL::text AS opponent_two_name
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams p1 ON p1.id=m.team_one_id
LEFT JOIN public.tournament_teams p2 ON p2.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs a ON a.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs b ON b.id=m.pair_two_id
LEFT JOIN LATERAL (SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id WHERE mp.match_id=m.id AND mp.side=1) side_one ON true
LEFT JOIN LATERAL (SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id WHERE mp.match_id=m.id AND mp.side=2) side_two ON true
WHERE e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'));

DROP POLICY IF EXISTS "Public read published tournament match players" ON public.tournament_match_players;
CREATE POLICY "Public read published tournament match players" ON public.tournament_match_players FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'))))
);

CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF v_payment.status <> 'succeeded' THEN RAISE EXCEPTION 'Only succeeded payments can be fulfilled'; END IF;

  IF v_payment.purpose = 'membership' THEN
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid family reference on payment'; END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      UPDATE public.membership_families SET paid_at = COALESCE(paid_at, now()), paid_by = COALESCE(paid_by, v_payment.user_id), payment_id = COALESCE(payment_id, v_payment.id) WHERE id = v_family_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    ELSIF v_payment.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_membership_id := v_payment.business_record_id::uuid;
      UPDATE public.memberships SET status = 'active', payment_status = 'paid', updated_at = now() WHERE id = v_membership_id AND user_id = v_payment.user_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'Membership or family record was not found for payment';
  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid registration reference on payment'; END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r SET payment_status = 'paid', payment_provider = 'stripe', provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id), updated_at = now()
    FROM public.events e WHERE r.id = v_registration_id AND r.event_id = e.id AND r.user_id = v_payment.user_id AND r.status = 'confirmed' AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSIF v_payment.purpose = 'tournament_registration' THEN
    IF coalesce(array_length(string_to_array(v_payment.business_record_id, ','), 1), 0) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Invalid tournament entry reference on payment'; END IF;
    BEGIN v_ids := string_to_array(v_payment.business_record_id, ',')::uuid[]; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid tournament participant reference'; END;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id = v_payment.user_id) THEN RAISE EXCEPTION 'The payer must be one of the tournament participants'; END IF;
    IF (SELECT count(DISTINCT p.event_id) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> 1 OR (SELECT count(*) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'Tournament entries must exist and belong to the same event'; END IF;
    UPDATE public.tournament_participants p SET payment_status = 'paid', payment_id = v_payment.id, updated_at = now()
    WHERE p.id = ANY(v_ids) AND p.status = 'registered' AND p.payment_status IN ('pending','failed') AND p.amount_cents > 0;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND (p.payment_status <> 'paid' OR p.payment_id IS DISTINCT FROM v_payment.id)) THEN RAISE EXCEPTION 'Tournament entries do not match the successful payment'; END IF;
    IF (SELECT coalesce(sum(p.amount_cents), 0) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> v_payment.amount_minor THEN RAISE EXCEPTION 'Tournament entry total does not match the payment amount'; END IF;
    RETURN;
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Keep public and administrator tournament views synchronized with changes made by organizers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'events',
    'tournament_teams',
    'tournament_participants',
    'tournament_pairs',
    'tournament_matches',
    'tournament_match_players',
    'tournament_audit_log'
  ] loop
    if to_regclass('public.' || table_name) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

-- Emit a public event-row change whenever tournament data changes. This lets
-- public clients refresh even when the underlying participant tables are private.
create or replace function public.bump_tournament_event_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if tg_table_name = 'tournament_match_players' then
    if tg_op = 'DELETE' then
      select event_id into v_event_id from public.tournament_matches where id = old.match_id;
    else
      select event_id into v_event_id from public.tournament_matches where id = new.match_id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_event_id := old.event_id;
    else
      v_event_id := new.event_id;
    end if;
  end if;

  if v_event_id is not null then
    update public.events set updated_at = now() where id = v_event_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_tournament_event_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tournament_teams',
    'tournament_participants',
    'tournament_pairs',
    'tournament_matches',
    'tournament_match_players',
    'tournament_audit_log'
  ] loop
    execute format('drop trigger if exists bump_event_updated_at on public.%I', table_name);
    execute format(
      'create trigger bump_event_updated_at after insert or update or delete on public.%I for each row execute function public.bump_tournament_event_updated_at()',
      table_name
    );
  end loop;
end;
$$;

-- Enforce category eligibility whenever a participant has a known gender. An unset gender remains eligible for any enabled category.
CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text DEFAULT NULL, p_email text DEFAULT NULL,
 p_phone text DEFAULT NULL, p_gender text DEFAULT NULL, p_partner_participant_id uuid DEFAULT NULL,
 p_partner_name text DEFAULT NULL, p_partner_email text DEFAULT NULL, p_partner_phone text DEFAULT NULL,
 p_partner_gender text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := auth.uid(); v_event public.events%rowtype; v_profile public.profiles%rowtype;
 v_config jsonb; v_mode text; v_gender text; v_partner_gender text; v_participant_id uuid; v_partner_id uuid;
 v_pair_id uuid; v_amount integer; v_count integer;
BEGIN
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
 IF NOT FOUND OR v_event.event_type<>'tournament' OR v_event.status<>'published' THEN RAISE EXCEPTION 'Tournament registration is unavailable'; END IF;
 IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
   RAISE EXCEPTION 'Tournament registration is closed';
 END IF;
 IF p_category NOT IN ('mixed','men','women','team') THEN RAISE EXCEPTION 'Invalid tournament category'; END IF;
 v_config := coalesce(v_event.tournament_config,'{}'::jsonb);
 v_mode := coalesce(v_config->>'registration_mode','both');
 IF v_event.tournament_format='team' THEN
   IF p_category<>'team' THEN RAISE EXCEPTION 'Team tournaments register participants for team assignment'; END IF;
 ELSE
   IF p_category='team' OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN RAISE EXCEPTION 'This doubles category is not enabled'; END IF;
 END IF;
 IF p_partner_participant_id IS NOT NULL OR nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF v_event.tournament_format<>'doubles' OR v_mode='single' THEN RAISE EXCEPTION 'This tournament accepts individual registration only'; END IF;
 ELSIF v_event.tournament_format='doubles' AND v_mode='doubles' THEN
   RAISE EXCEPTION 'Register with a partner for this tournament';
 END IF;
 IF v_user IS NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Sign in to register for this tournament'; END IF;
   IF nullif(btrim(p_display_name),'') IS NULL OR nullif(btrim(p_email),'') IS NULL THEN RAISE EXCEPTION 'Name and email are required for non-member registration'; END IF;
   IF length(btrim(p_display_name))>160 OR length(btrim(p_email))>254 THEN RAISE EXCEPTION 'Participant details are too long'; END IF;
   v_gender := p_gender;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'This email is already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='women' AND status='registered')) OR (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='men' AND status='registered')) THEN RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles'; END IF;
 ELSE
   SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
   IF NOT FOUND OR v_profile.application_status<>'approved' THEN RAISE EXCEPTION 'An approved member profile is required'; END IF;
   v_gender := v_profile.gender;
   SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND status='registered';
   IF v_event.tournament_format='team' AND v_count>=1 THEN RAISE EXCEPTION 'You are already registered for this team tournament'; END IF;
   IF v_event.tournament_format='doubles' AND v_count>=2 THEN RAISE EXCEPTION 'A player may enter no more than two doubles categories'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'You are already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='women' AND status='registered')) OR
      (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='men' AND status='registered')) THEN
     RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
   END IF;
 END IF;
 IF p_category='men' AND v_gender IS NOT NULL AND v_gender<>'male' THEN RAISE EXCEPTION 'The entered gender is not eligible for men''s doubles'; END IF;
 IF p_category='women' AND v_gender IS NOT NULL AND v_gender<>'female' THEN RAISE EXCEPTION 'The entered gender is not eligible for women''s doubles'; END IF;
 IF p_category='mixed' AND v_gender IS NOT NULL AND v_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The entered gender is not eligible for mixed doubles'; END IF;
 IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender value'; END IF;
 v_amount := v_event.price_cents;
 INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
 VALUES(p_event_id,v_user,p_category,CASE WHEN v_user IS NOT NULL THEN coalesce(nullif(v_profile.full_name,''),v_profile.email) ELSE btrim(p_display_name) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.email ELSE lower(btrim(p_email)) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.phone ELSE nullif(btrim(p_phone),'') END,
        v_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
 RETURNING id INTO v_participant_id;
 IF p_partner_participant_id IS NOT NULL THEN
   SELECT coalesce(gender_override,gender) INTO v_partner_gender FROM public.tournament_participants
   WHERE id=p_partner_participant_id AND event_id=p_event_id AND category=p_category AND status='registered';
   IF NOT FOUND THEN RAISE EXCEPTION 'The selected partner is not registered in this category'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_pairs WHERE event_id=p_event_id AND category=p_category AND (player_one_id=p_partner_participant_id OR player_two_id=p_partner_participant_id)) THEN RAISE EXCEPTION 'The selected partner is already paired in this category'; END IF;
   v_partner_id := p_partner_participant_id;
 ELSIF nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Register the partner as a member first, or ask the organizer to enable non-member registration'; END IF;
   IF nullif(btrim(p_partner_email),'') IS NULL THEN RAISE EXCEPTION 'Partner email is required'; END IF;
   IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender value'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_partner_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'Partner email is already registered in this category'; END IF;
   IF p_category='men' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'male' THEN RAISE EXCEPTION 'The partner gender is not eligible for men''s doubles'; END IF;
   IF p_category='women' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'female' THEN RAISE EXCEPTION 'The partner gender is not eligible for women''s doubles'; END IF;
   IF p_category='mixed' AND p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The partner gender is not eligible for mixed doubles'; END IF;
   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;
 IF p_category='mixed' AND v_gender IS NOT NULL AND v_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The entered gender is not eligible for mixed doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'male' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'female' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_partner_gender IS NOT NULL AND v_partner_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The selected partner is not eligible for mixed doubles'; END IF;
 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;

REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;

-- Public tournament views expose only the effective tournament gender used for eligibility.
-- Contact and payment fields remain excluded from this view.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));

-- Expose tennis skill ratings on published tournament participant rows, without exposing contact data.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status,
       profile.tennis_skill_level
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name,
       profile_a.tennis_skill_level AS player_one_skill_level,
       profile_b.tennis_skill_level AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own
  WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));

-- Tournament registration improvements: optional guest skill ratings, member partner lookup,
-- provisional guest entries, per-participant payment/withdrawal and category-safe reuse.
ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS tennis_skill_level numeric(2,1);
ALTER TABLE public.tournament_participants
  DROP CONSTRAINT IF EXISTS tournament_participants_status_check;
ALTER TABLE public.tournament_participants
  ADD CONSTRAINT tournament_participants_status_check
  CHECK (status IN ('registered','provisional','withdrawn','replaced'));
ALTER TABLE public.tournament_participants
  DROP CONSTRAINT IF EXISTS tournament_participants_tennis_skill_level_check;
ALTER TABLE public.tournament_participants
  ADD CONSTRAINT tournament_participants_tennis_skill_level_check
  CHECK (tennis_skill_level IS NULL OR (tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(tennis_skill_level - 2.5, 0.5) = 0));
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_email_category_active_idx
  ON public.tournament_participants(event_id, lower(email), category)
  WHERE email IS NOT NULL AND status IN ('registered','provisional');

-- Keep the public views limited to completed registrations and prefer a manually entered
-- guest skill rating over the profile rating.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status,
       coalesce(p.tennis_skill_level::text, profile.tennis_skill_level) AS tennis_skill_level,
       (p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name,
       coalesce(a.tennis_skill_level::text, profile_a.tennis_skill_level) AS player_one_skill_level,
       coalesce(b.tennis_skill_level::text, profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own
  WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));

CREATE OR REPLACE FUNCTION public.event_tournament_partner_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'
  ) THEN RAISE EXCEPTION 'An approved member account is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.event_type='tournament' AND e.status='published') THEN
    RAISE EXCEPTION 'Tournament is unavailable';
  END IF;
  RETURN QUERY SELECT p.id, coalesce(nullif(p.full_name,''), p.email), p.gender
  FROM public.profiles p
  WHERE p.application_status='approved' AND p.id<>auth.uid()
  ORDER BY coalesce(nullif(p.full_name,''), p.email);
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_partner_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_partner_directory(uuid) TO authenticated;

-- New signature supports selecting any approved member as a partner and optional skill ratings.
-- The original registration RPC remains intact for compatibility with existing callers.
CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text, p_email text, p_phone text,
 p_gender text, p_partner_participant_id uuid, p_partner_name text, p_partner_email text,
 p_partner_phone text, p_partner_gender text, p_partner_user_id uuid,
 p_tennis_skill_level numeric, p_partner_tennis_skill_level numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_partner public.profiles%rowtype;
  v_participant_id uuid;
  v_partner_participant_id uuid;
  v_pair_id uuid;
  v_status text;
BEGIN
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(p_tennis_skill_level - 2.5, 0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_tennis_skill_level IS NOT NULL AND NOT (p_partner_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(p_partner_tennis_skill_level - 2.5, 0.5)=0) THEN
    RAISE EXCEPTION 'Partner skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_user_id IS NOT NULL THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to select a member partner'; END IF;
    IF p_partner_participant_id IS NOT NULL OR p_partner_name IS NOT NULL THEN RAISE EXCEPTION 'Select only one partner source'; END IF;
    SELECT * INTO v_partner FROM public.profiles WHERE id=p_partner_user_id AND application_status='approved';
    IF NOT FOUND OR p_partner_user_id=auth.uid() THEN RAISE EXCEPTION 'Select a different approved member as partner'; END IF;
    SELECT id INTO p_partner_participant_id FROM public.tournament_participants
      WHERE event_id=p_event_id AND user_id=p_partner_user_id AND category=p_category AND status='registered'
      LIMIT 1;
    IF p_partner_participant_id IS NULL THEN
      p_partner_name := coalesce(nullif(v_partner.full_name,''), v_partner.email);
      p_partner_email := v_partner.email;
      p_partner_phone := v_partner.phone;
      p_partner_gender := v_partner.gender;
    END IF;
  END IF;
  v_result := public.register_tournament_entry(
    p_event_id, p_category, p_display_name, p_email, p_phone, p_gender,
    p_partner_participant_id, p_partner_name, p_partner_email, p_partner_phone, p_partner_gender
  );
  v_participant_id := (v_result->>'participantId')::uuid;
  v_partner_participant_id := nullif(v_result->>'partnerParticipantId','')::uuid;
  v_pair_id := nullif(v_result->>'pairId','')::uuid;
  SELECT payment_status INTO v_status FROM public.tournament_participants WHERE id=v_participant_id;
  v_result := jsonb_set(v_result, '{paymentStatus}', to_jsonb(v_status), true);
  IF p_tennis_skill_level IS NOT NULL THEN
    UPDATE public.tournament_participants SET tennis_skill_level=p_tennis_skill_level WHERE id=v_participant_id;
  END IF;
  IF v_partner_participant_id IS NOT NULL THEN
    IF p_partner_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=v_partner_participant_id AND user_id IS NULL) THEN
      UPDATE public.tournament_participants SET user_id=p_partner_user_id,
        display_name=coalesce(nullif(v_partner.full_name,''),v_partner.email), email=v_partner.email,
        phone=v_partner.phone, gender=v_partner.gender
      WHERE id=v_partner_participant_id;
    END IF;
    IF p_partner_tennis_skill_level IS NOT NULL THEN
      UPDATE public.tournament_participants SET tennis_skill_level=p_partner_tennis_skill_level WHERE id=v_partner_participant_id;
    END IF;
  END IF;
  IF auth.uid() IS NULL AND coalesce((v_result->>'amountCents')::integer,0)>0 THEN
    UPDATE public.tournament_participants SET status='provisional' WHERE id=v_participant_id;
    IF v_partner_participant_id IS NOT NULL AND p_partner_participant_id IS NULL AND p_partner_name IS NOT NULL THEN
      UPDATE public.tournament_participants SET status='provisional' WHERE id=v_partner_participant_id AND user_id IS NULL;
    END IF;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) TO anon, authenticated;

-- Successful payment finalizes guest registrations. A trigger keeps this true for all
-- payment fulfillment paths (webhook, status reconciliation, and administrator recovery).
CREATE OR REPLACE FUNCTION public.finalize_paid_tournament_guest_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.status='provisional' THEN
    NEW.status := 'registered';
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finalize_paid_tournament_guest_entry ON public.tournament_participants;
CREATE TRIGGER finalize_paid_tournament_guest_entry
BEFORE UPDATE OF payment_status ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.finalize_paid_tournament_guest_entry();

CREATE OR REPLACE FUNCTION public.withdraw_tournament_entry(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_event public.events%rowtype;
BEGIN
  SELECT * INTO v_entry FROM public.tournament_participants WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered entry not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now() >= coalesce(v_event.registration_closes_at, v_event.starts_at) THEN RAISE EXCEPTION 'The withdrawal cutoff has passed'; END IF;
  UPDATE public.tournament_participants SET status='withdrawn', updated_at=now() WHERE id=v_entry.id;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE event_id=v_entry.event_id AND category=v_entry.category
    AND (player_one_id=v_entry.id OR player_two_id=v_entry.id) AND status='active';
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_tournament_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_tournament_entry(uuid) TO authenticated;

-- Reuse is limited to a previously paid, never-refunded entry for the same event and category.
CREATE OR REPLACE FUNCTION public.reuse_prior_tournament_entry_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prior public.payments%rowtype;
BEGIN
  IF NEW.status <> 'registered' OR NEW.amount_cents <= 0 OR NEW.user_id IS NULL OR NEW.payment_status NOT IN ('pending','failed') THEN RETURN NEW; END IF;
  SELECT pay.* INTO v_prior FROM public.payments pay
  JOIN public.tournament_participants old_entry ON old_entry.id::text=ANY(string_to_array(pay.business_record_id, ','))
  WHERE pay.purpose='tournament_registration' AND pay.status='succeeded'
    AND coalesce(pay.refunded_amount_minor,0)=0 AND old_entry.payment_id=pay.id
    AND old_entry.amount_cents=NEW.amount_cents
    AND old_entry.event_id=NEW.event_id AND old_entry.category=NEW.category
    AND old_entry.status='withdrawn' AND old_entry.user_id=NEW.user_id
  ORDER BY pay.succeeded_at DESC NULLS LAST, pay.created_at DESC LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    NEW.payment_status := 'paid';
    NEW.payment_id := v_prior.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reuse_prior_tournament_entry_payment ON public.tournament_participants;
CREATE TRIGGER reuse_prior_tournament_entry_payment BEFORE INSERT OR UPDATE ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.reuse_prior_tournament_entry_payment();


-- Guest Stripe payments can fulfill only non-member tournament entries.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF v_payment.status <> 'succeeded' THEN RAISE EXCEPTION 'Only succeeded payments can be fulfilled'; END IF;

  IF v_payment.purpose = 'membership' THEN
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid family reference on payment'; END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      UPDATE public.membership_families SET paid_at = COALESCE(paid_at, now()), paid_by = COALESCE(paid_by, v_payment.user_id), payment_id = COALESCE(payment_id, v_payment.id) WHERE id = v_family_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    ELSIF v_payment.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_membership_id := v_payment.business_record_id::uuid;
      UPDATE public.memberships SET status = 'active', payment_status = 'paid', updated_at = now() WHERE id = v_membership_id AND user_id = v_payment.user_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'Membership or family record was not found for payment';
  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid registration reference on payment'; END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r SET payment_status = 'paid', payment_provider = 'stripe', provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id), updated_at = now()
    FROM public.events e WHERE r.id = v_registration_id AND r.event_id = e.id AND r.user_id = v_payment.user_id AND r.status = 'confirmed' AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSIF v_payment.purpose = 'tournament_registration' THEN
    IF coalesce(array_length(string_to_array(v_payment.business_record_id, ','), 1), 0) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Invalid tournament entry reference on payment'; END IF;
    BEGIN v_ids := string_to_array(v_payment.business_record_id, ',')::uuid[]; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid tournament participant reference'; END;
    IF v_payment.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id = v_payment.user_id) AND NOT EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants payer ON payer.id IN (pair.player_one_id,pair.player_two_id)
      JOIN public.tournament_participants target ON target.id IN (pair.player_one_id,pair.player_two_id) AND target.id <> payer.id
      WHERE pair.event_id=(SELECT event_id FROM public.tournament_participants WHERE id=ANY(v_ids) LIMIT 1)
        AND pair.status='active' AND payer.user_id=v_payment.user_id AND target.id=ANY(v_ids)
    ) THEN RAISE EXCEPTION 'The payer must be one of the tournament participants or their registered partner'; END IF;
    IF v_payment.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id IS NULL AND p.status IN ('provisional','registered')) AND NOT EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants guest ON guest.id IN (pair.player_one_id,pair.player_two_id)
      JOIN public.tournament_participants target ON target.id IN (pair.player_one_id,pair.player_two_id) AND target.id <> guest.id
      WHERE pair.status='active' AND target.id=ANY(v_ids) AND guest.user_id IS NULL AND guest.status='registered'
    ) THEN RAISE EXCEPTION 'Guest payments must include a non-member entry or its paired entry'; END IF;
    IF (SELECT count(DISTINCT p.event_id) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> 1 OR (SELECT count(*) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'Tournament entries must exist and belong to the same event'; END IF;
    UPDATE public.tournament_participants p SET payment_status = 'paid', payment_id = v_payment.id, updated_at = now()
    WHERE p.id = ANY(v_ids) AND p.status IN ('registered','provisional') AND p.payment_status IN ('pending','failed') AND p.amount_cents > 0;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND (p.payment_status <> 'paid' OR p.payment_id IS DISTINCT FROM v_payment.id)) THEN RAISE EXCEPTION 'Tournament entries do not match the successful payment'; END IF;
    IF (SELECT coalesce(sum(p.amount_cents), 0) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> v_payment.amount_minor THEN RAISE EXCEPTION 'Tournament entry total does not match the payment amount'; END IF;
    RETURN;
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Reveal only the paired payment state to a participant in that pair, so the team is
-- marked paid only when both individual entry fees have been satisfied.
CREATE OR REPLACE FUNCTION public.event_tournament_pair_payment_status(p_event_id uuid)
RETURNS TABLE(pair_id uuid, player_one_id uuid, player_two_id uuid, player_one_payment_status text, player_two_payment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  RETURN QUERY
  SELECT pair.id, pair.player_one_id, pair.player_two_id, one.payment_status, two.payment_status
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants one ON one.id=pair.player_one_id
  JOIN public.tournament_participants two ON two.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.status='active'
    AND one.status='registered' AND two.status='registered'
    AND (one.user_id=auth.uid() OR two.user_id=auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_pair_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_pair_payment_status(uuid) TO authenticated;

-- Publicly published events expose organizer identity/role, but not private contact details.
CREATE OR REPLACE FUNCTION public.event_public_organizer_contacts(p_event_id uuid)
RETURNS TABLE(organizer_id uuid, organizer_name text, "position" text, emails text[], phones text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, coalesce(nullif(p.full_name,''), 'Event organizer'),
         coalesce(cc.position, CASE WHEN p.role='organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
         ARRAY[]::text[], ARRAY[]::text[]
  FROM public.events e
  JOIN public.profiles p ON p.id=coalesce(e.organizer_id,e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id=p.id
  WHERE e.id=p_event_id AND e.status IN ('published','cancelled');
$$;
REVOKE ALL ON FUNCTION public.event_public_organizer_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_public_organizer_contacts(uuid) TO anon, authenticated;


-- Preserve category checks for known genders, but treat unspecified/legacy non-binary values as unknown.
CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text DEFAULT NULL, p_email text DEFAULT NULL,
 p_phone text DEFAULT NULL, p_gender text DEFAULT NULL, p_partner_participant_id uuid DEFAULT NULL,
 p_partner_name text DEFAULT NULL, p_partner_email text DEFAULT NULL, p_partner_phone text DEFAULT NULL,
 p_partner_gender text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := auth.uid(); v_event public.events%rowtype; v_profile public.profiles%rowtype;
 v_config jsonb; v_mode text; v_gender text; v_partner_gender text; v_participant_id uuid; v_partner_id uuid;
 v_pair_id uuid; v_amount integer; v_count integer;
BEGIN
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
 IF NOT FOUND OR v_event.event_type<>'tournament' OR v_event.status<>'published' THEN RAISE EXCEPTION 'Tournament registration is unavailable'; END IF;
 IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
   RAISE EXCEPTION 'Tournament registration is closed';
 END IF;
 IF p_category NOT IN ('mixed','men','women','team') THEN RAISE EXCEPTION 'Invalid tournament category'; END IF;
 v_config := coalesce(v_event.tournament_config,'{}'::jsonb);
 v_mode := coalesce(v_config->>'registration_mode','both');
 IF v_event.tournament_format='team' THEN
   IF p_category<>'team' THEN RAISE EXCEPTION 'Team tournaments register participants for team assignment'; END IF;
 ELSE
   IF p_category='team' OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN RAISE EXCEPTION 'This doubles category is not enabled'; END IF;
 END IF;
 IF p_partner_participant_id IS NOT NULL OR nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF v_event.tournament_format<>'doubles' OR v_mode='single' THEN RAISE EXCEPTION 'This tournament accepts individual registration only'; END IF;
 ELSIF v_event.tournament_format='doubles' AND v_mode='doubles' THEN
   RAISE EXCEPTION 'Register with a partner for this tournament';
 END IF;
 IF v_user IS NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Sign in to register for this tournament'; END IF;
   IF nullif(btrim(p_display_name),'') IS NULL OR nullif(btrim(p_email),'') IS NULL THEN RAISE EXCEPTION 'Name and email are required for non-member registration'; END IF;
   IF length(btrim(p_display_name))>160 OR length(btrim(p_email))>254 THEN RAISE EXCEPTION 'Participant details are too long'; END IF;
   v_gender := p_gender;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'This email is already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='women' AND status='registered')) OR (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='men' AND status='registered')) THEN RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles'; END IF;
 ELSE
   SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
   IF NOT FOUND OR v_profile.application_status<>'approved' THEN RAISE EXCEPTION 'An approved member profile is required'; END IF;
   v_gender := v_profile.gender;
   SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND status='registered';
   IF v_event.tournament_format='team' AND v_count>=1 THEN RAISE EXCEPTION 'You are already registered for this team tournament'; END IF;
   IF v_event.tournament_format='doubles' AND v_count>=2 THEN RAISE EXCEPTION 'A player may enter no more than two doubles categories'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'You are already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='women' AND status='registered')) OR
      (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='men' AND status='registered')) THEN
     RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
   END IF;
 END IF;
 IF p_category='men' AND v_gender IS NOT NULL AND v_gender<>'male' THEN RAISE EXCEPTION 'The entered gender is not eligible for men''s doubles'; END IF;
 IF p_category='women' AND v_gender IS NOT NULL AND v_gender<>'female' THEN RAISE EXCEPTION 'The entered gender is not eligible for women''s doubles'; END IF;

 IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender value'; END IF;
 v_amount := v_event.price_cents;
 INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
 VALUES(p_event_id,v_user,p_category,CASE WHEN v_user IS NOT NULL THEN coalesce(nullif(v_profile.full_name,''),v_profile.email) ELSE btrim(p_display_name) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.email ELSE lower(btrim(p_email)) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.phone ELSE nullif(btrim(p_phone),'') END,
        v_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
 RETURNING id INTO v_participant_id;
 IF p_partner_participant_id IS NOT NULL THEN
   SELECT coalesce(gender_override,gender) INTO v_partner_gender FROM public.tournament_participants
   WHERE id=p_partner_participant_id AND event_id=p_event_id AND category=p_category AND status='registered';
   IF NOT FOUND THEN RAISE EXCEPTION 'The selected partner is not registered in this category'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_pairs WHERE event_id=p_event_id AND category=p_category AND (player_one_id=p_partner_participant_id OR player_two_id=p_partner_participant_id)) THEN RAISE EXCEPTION 'The selected partner is already paired in this category'; END IF;
   v_partner_id := p_partner_participant_id;
 ELSIF nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Register the partner as a member first, or ask the organizer to enable non-member registration'; END IF;
   IF nullif(btrim(p_partner_email),'') IS NULL THEN RAISE EXCEPTION 'Partner email is required'; END IF;
   IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender value'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_partner_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'Partner email is already registered in this category'; END IF;
   IF p_category='men' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'male' THEN RAISE EXCEPTION 'The partner gender is not eligible for men''s doubles'; END IF;
   IF p_category='women' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'female' THEN RAISE EXCEPTION 'The partner gender is not eligible for women''s doubles'; END IF;

   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;

 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'male' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'female' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;

 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;

-- Public tournament pages fetch organizer contact details only after a visitor
-- explicitly selects "Show contacts". The initial public page receives names only.
CREATE OR REPLACE FUNCTION public.event_public_tournament_organizer_contact_details(p_event_id uuid)
RETURNS TABLE(
  organizer_id uuid,
  organizer_name text,
  "position" text,
  emails text[],
  phones text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    p.id,
    coalesce(nullif(p.full_name, ''), 'Event organizer'),
    coalesce(cc.position, CASE WHEN p.role = 'organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
    CASE WHEN cc.emails IS NOT NULL AND cardinality(cc.emails) > 0 THEN cc.emails WHEN p.email IS NOT NULL THEN ARRAY[p.email]::text[] ELSE ARRAY[]::text[] END,
    CASE WHEN cc.phones IS NOT NULL AND cardinality(cc.phones) > 0 THEN cc.phones WHEN p.phone IS NOT NULL THEN ARRAY[p.phone]::text[] ELSE ARRAY[]::text[] END
  FROM public.events e
  JOIN public.profiles p ON p.id = coalesce(e.organizer_id, e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id = p.id
  WHERE e.id = p_event_id AND e.event_type = 'tournament' AND e.status = 'published';
$$;
REVOKE ALL ON FUNCTION public.event_public_tournament_organizer_contact_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_public_tournament_organizer_contact_details(uuid) TO anon, authenticated;


-- Add optional overall and per-category tournament capacities. The existing events.capacity
-- remains populated for compatibility with legacy event flows; a large sentinel represents
-- an intentionally unlimited tournament when tournament_config.total_capacity is NULL.
CREATE OR REPLACE FUNCTION public.guard_tournament_participant_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_config jsonb;
  v_total_limit integer;
  v_category_limit integer;
  v_total_count integer;
  v_category_count integer;
BEGIN
  IF public.is_event_manager() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text)::bigint);
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_event.event_type <> 'tournament' OR v_event.status <> 'published'
     OR now() < v_event.registration_opens_at
     OR (v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at)
     OR now() >= v_event.starts_at THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF auth.uid() IS NULL THEN
    IF NOT v_event.allow_non_member_registration OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  ELSE
    IF NEW.user_id = auth.uid() THEN
      IF v_event.members_only AND NOT public.current_user_has_active_paid_membership() THEN
        RAISE EXCEPTION 'An active paid membership is required for this tournament';
      END IF;
    ELSIF NEW.user_id IS NULL AND NOT v_event.allow_non_member_registration THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  END IF;

  -- Only active registrations occupy capacity. A newly inserted partner is counted as a
  -- separate participant entry, so the second insert is checked against the updated totals.
  IF NEW.status IN ('registered', 'provisional') THEN
    v_config := coalesce(v_event.tournament_config, '{}'::jsonb);
    v_total_limit := nullif(v_config->>'total_capacity', '')::integer;
    IF v_total_limit IS NULL THEN
      -- Events created before the optional-capacity feature keep their legacy limit.
      IF v_config ? 'total_capacity' THEN
        v_total_limit := NULL;
      ELSE
        v_total_limit := v_event.capacity;
      END IF;
    END IF;
    SELECT count(*) INTO v_total_count
      FROM public.tournament_participants
      WHERE event_id = NEW.event_id AND status IN ('registered', 'provisional');
    IF v_total_limit IS NOT NULL AND v_total_count >= v_total_limit THEN
      RAISE EXCEPTION 'Tournament total capacity has been reached';
    END IF;

    v_category_limit := nullif(v_config->'category_capacities'->>NEW.category, '')::integer;
    IF v_category_limit IS NOT NULL THEN
      SELECT count(*) INTO v_category_count
        FROM public.tournament_participants
        WHERE event_id = NEW.event_id AND category = NEW.category
          AND status IN ('registered', 'provisional');
      IF v_category_count >= v_category_limit THEN
        RAISE EXCEPTION 'Capacity for this tournament category has been reached';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Persist administrator overrides for tournament group rankings and promotion badges.
CREATE TABLE IF NOT EXISTS public.tournament_group_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL,
  group_number integer NOT NULL CHECK (group_number > 0),
  entry_id uuid NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('ranking', 'promotion')),
  override_value integer NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, category, group_number, entry_id, override_type)
);
CREATE INDEX IF NOT EXISTS tournament_group_overrides_event_idx
  ON public.tournament_group_overrides(event_id, category, group_number);
ALTER TABLE public.tournament_group_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read published tournament group overrides" ON public.tournament_group_overrides;
CREATE POLICY "Public can read published tournament group overrides"
  ON public.tournament_group_overrides FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id AND e.status = 'published' AND e.tournament_details_public = true
  ));
DROP POLICY IF EXISTS "Tournament managers manage group overrides" ON public.tournament_group_overrides;
CREATE POLICY "Tournament managers manage group overrides"
  ON public.tournament_group_overrides FOR ALL TO authenticated
  USING (
    public.is_event_manager() AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND (public.is_admin() OR e.organizer_id = auth.uid() OR e.created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_event_manager() AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND (public.is_admin() OR e.organizer_id = auth.uid() OR e.created_by = auth.uid())
    )
  );
GRANT SELECT ON public.tournament_group_overrides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tournament_group_overrides TO authenticated;

-- Social Doubles Ladder: persistent competition identity and event configuration.
create table if not exists public.social_doubles_ladders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text not null check (gender in ('male','female')),
  position_points integer[] not null default array[2,1,-1,-2],
  ranking_priority text[] not null default array['games_won','sets_won','games_difference'],
  carryover_mode text not null default 'none' check (carryover_mode in ('none','position','full')),
  previous_ladder_id uuid references public.social_doubles_ladders(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (array_length(position_points, 1) = 4),
  check (cardinality(ranking_priority) > 0)
);
alter table public.events
  add column if not exists social_doubles_ladder_id uuid references public.social_doubles_ladders(id) on delete set null,
  add column if not exists ladder_gender text check (ladder_gender is null or ladder_gender in ('male','female')),
  add column if not exists ladder_position_points integer[],
  add column if not exists ladder_ranking_priority text[];

create index if not exists events_social_doubles_ladder_idx
  on public.events(social_doubles_ladder_id, starts_at);
create index if not exists social_doubles_ladders_ends_at_idx
  on public.social_doubles_ladders(ends_at desc nulls last);

alter table public.social_doubles_ladders enable row level security;
drop policy if exists "Approved users can view social doubles ladders" on public.social_doubles_ladders;
create policy "Approved users can view social doubles ladders"
  on public.social_doubles_ladders for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'));
drop policy if exists "Admins and organizers manage social doubles ladders" on public.social_doubles_ladders;
create policy "Admins and organizers manage social doubles ladders"
  on public.social_doubles_ladders for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'
      and (p.role = 'admin' or p.role = 'organizer' or created_by = auth.uid()))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'
      and (p.role = 'admin' or p.role = 'organizer' or created_by = auth.uid()))
  );

comment on table public.social_doubles_ladders is 'Seasonal Social Doubles Ladder identities; each ladder is strictly mens or womens.';
comment on column public.events.social_doubles_ladder_id is 'Links a social doubles ladder session to its cumulative ladder.';


create table if not exists public.social_doubles_ladder_seeds (
  ladder_id uuid not null references public.social_doubles_ladders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  initial_position integer not null check (initial_position > 0),
  initial_points integer not null default 0,
  primary key (ladder_id, user_id),
  unique (ladder_id, initial_position)
);
alter table public.social_doubles_ladder_seeds enable row level security;
drop policy if exists "Approved users can view ladder seeds" on public.social_doubles_ladder_seeds;
create policy "Approved users can view ladder seeds" on public.social_doubles_ladder_seeds
  for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'));
drop policy if exists "Admins and organizers manage ladder seeds" on public.social_doubles_ladder_seeds;
create policy "Admins and organizers manage ladder seeds" on public.social_doubles_ladder_seeds
  for all to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved' and (p.role = 'admin' or p.role = 'organizer')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved' and (p.role = 'admin' or p.role = 'organizer')));

GRANT SELECT ON public.social_doubles_ladders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.social_doubles_ladders TO authenticated;
GRANT SELECT ON public.social_doubles_ladder_seeds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.social_doubles_ladder_seeds TO authenticated;


-- Ladder names are identities across events/seasons and must be unique, case-insensitively.
create unique index if not exists social_doubles_ladders_name_ci_unique
  on public.social_doubles_ladders (lower(btrim(name)));

-- Allow Social Doubles Ladder events while preserving the existing event types.

DO $$
DECLARE
    existing_check TEXT;
BEGIN
    SELECT pg_get_expr(conbin, conrelid)
    INTO existing_check
    FROM pg_constraint
    WHERE conname = 'events_event_type_check'
      AND conrelid = 'public.events'::regclass
      AND contype = 'c';

    IF existing_check IS NULL THEN
        RAISE EXCEPTION
            'Could not find check constraint events_event_type_check on public.events';
    END IF;

    ALTER TABLE public.events
        DROP CONSTRAINT events_event_type_check;

    EXECUTE format(
        'ALTER TABLE public.events
         ADD CONSTRAINT events_event_type_check
         CHECK ((%s) OR (event_type = %L))',
        existing_check,
        'social_doubles_ladder'
    );
END
$$;


-- Allow members and managers to update their own profile fields, and limit score
-- editing/deletion to admins and the user who entered the score.

DROP POLICY IF EXISTS "Members update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Managers may still enter scores for any assigned court/player combination.
DROP POLICY IF EXISTS "Event managers manage scores" ON public.event_scores;
DROP POLICY IF EXISTS "Event managers insert scores" ON public.event_scores;
CREATE POLICY "Event managers insert scores" ON public.event_scores FOR INSERT TO authenticated
  WITH CHECK (public.is_event_manager());

DROP POLICY IF EXISTS "Admins edit recent scores" ON public.event_scores;
CREATE POLICY "Admins edit recent scores" ON public.event_scores FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  );

DROP POLICY IF EXISTS "Admins and score authors delete recent scores" ON public.event_scores;
CREATE POLICY "Admins and score authors delete recent scores" ON public.event_scores FOR DELETE TO authenticated
  USING (
    (public.is_admin() OR entered_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  );

GRANT UPDATE, DELETE ON public.event_scores TO authenticated;

-- League tournaments use the existing ladder identity as their shared series configuration,
-- and existing doubles tournament events, registrations, pairs, matches, and scores.

ALTER TABLE public.social_doubles_ladders
  ADD COLUMN IF NOT EXISTS competition_type text NOT NULL DEFAULT 'ladder',
  ADD COLUMN IF NOT EXISTS season text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tournament_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tournament_rules_html text NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE public.social_doubles_ladders ADD CONSTRAINT social_doubles_ladders_competition_type_check CHECK (competition_type IN ('ladder','league'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.league_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  player_one_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  player_two_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_id <> player_two_id),
  UNIQUE (league_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_pair_unique ON public.league_teams(league_id,least(player_one_id,player_two_id),greatest(player_one_id,player_two_id)) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_player_one_unique ON public.league_teams(league_id,player_one_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_player_two_unique ON public.league_teams(league_id,player_two_id) WHERE status='active';
ALTER TABLE public.tournament_pairs ADD COLUMN IF NOT EXISTS league_team_id uuid REFERENCES public.league_teams(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_pairs_league_team_event_unique ON public.tournament_pairs(event_id,league_team_id) WHERE league_team_id IS NOT NULL AND status='active';

CREATE OR REPLACE FUNCTION public.prevent_league_gender_change_after_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.competition_type='league' AND (NEW.gender IS DISTINCT FROM OLD.gender OR NEW.competition_type IS DISTINCT FROM OLD.competition_type)
    AND EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=OLD.id AND t.status='active') THEN
    RAISE EXCEPTION 'League gender cannot change after teams are confirmed';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS prevent_league_gender_change_after_confirmation ON public.social_doubles_ladders;
CREATE TRIGGER prevent_league_gender_change_after_confirmation BEFORE UPDATE OF gender,competition_type ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.prevent_league_gender_change_after_confirmation();

CREATE TABLE IF NOT EXISTS public.league_standings_snapshots (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  configuration_version text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.league_current_standings (
  league_id uuid PRIMARY KEY REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  configuration_version text NOT NULL DEFAULT ''
);

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two) AND p.application_status<>'approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_league_tournament_pair ON public.tournament_pairs;
CREATE TRIGGER validate_league_tournament_pair BEFORE INSERT OR UPDATE OF player_one_id,player_two_id,league_team_id ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.validate_league_tournament_pair();

CREATE OR REPLACE FUNCTION public.require_established_league_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status NOT IN ('registered','provisional') THEN RETURN NEW; END IF;
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender FROM public.events e
    JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
    WHERE e.id=NEW.event_id AND e.event_type='tournament';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League registrations must use the league gender category';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND NEW.user_id IN (t.player_one_id,t.player_two_id)) THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_pairs pair
    JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
    JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
    JOIN public.league_teams t ON t.league_id=v_league AND t.status='active'
      AND ((t.player_one_id=p1.user_id AND t.player_two_id=p2.user_id) OR (t.player_one_id=p2.user_id AND t.player_two_id=p1.user_id))
    WHERE pair.event_id=NEW.event_id AND pair.category=NEW.category AND pair.status='active' AND NEW.user_id IN (p1.user_id,p2.user_id)
  ) THEN RAISE EXCEPTION 'Established league members must register with their confirmed partner'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS require_established_league_pair ON public.tournament_participants;
CREATE CONSTRAINT TRIGGER require_established_league_pair AFTER INSERT OR UPDATE ON public.tournament_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_established_league_pair();

CREATE OR REPLACE FUNCTION public.confirm_league_tournament_teams(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_count integer;
BEGIN
  SELECT e.social_doubles_ladder_id INTO v_league FROM public.events e
    JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  WITH new_pairs AS (
    SELECT DISTINCT ON (least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id))
      pair.id AS pair_id,p1.user_id AS one_id,p2.user_id AS two_id
    FROM public.tournament_pairs pair
    JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
    JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
    WHERE pair.event_id=p_event_id AND pair.status='active' AND p1.status='registered' AND p2.status='registered'
      AND p1.user_id IS NOT NULL AND p2.user_id IS NOT NULL
    ORDER BY least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id),pair.created_at,pair.id
  ), created AS (
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    SELECT v_league,one_id,two_id FROM new_pairs np
    WHERE NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
      AND ((t.player_one_id=np.one_id AND t.player_two_id=np.two_id) OR (t.player_one_id=np.two_id AND t.player_two_id=np.one_id)))
    RETURNING id
  ) SELECT count(*) INTO v_count FROM created;
  UPDATE public.tournament_pairs pair SET league_team_id=t.id
  FROM public.tournament_participants p1, public.tournament_participants p2, public.league_teams t
  WHERE pair.event_id=p_event_id AND pair.status='active' AND p1.id=pair.player_one_id AND p2.id=pair.player_two_id
    AND t.league_id=v_league AND t.status='active' AND ((t.player_one_id=p1.user_id AND t.player_two_id=p2.user_id) OR (t.player_one_id=p2.user_id AND t.player_two_id=p1.user_id));
  RETURN coalesce(v_count,0);
END; $$;
REVOKE ALL ON FUNCTION public.confirm_league_tournament_teams(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_league_tournament_teams(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz DEFAULT NULL,p_before_event uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH config AS (
    SELECT coalesce(tournament_config,'{}'::jsonb) AS cfg FROM public.social_doubles_ladders WHERE id=p_league_id AND competition_type='league'
  ), appearances AS (
    SELECT m.id AS match_id,m.status,m.winner_side,m.score_sets,m.event_id,
      CASE WHEN m.pair_one_id=pair.id THEN 1 ELSE 2 END AS side,pair.league_team_id AS team_id
    FROM public.tournament_matches m
    JOIN public.events e ON e.id=m.event_id AND e.social_doubles_ladder_id=p_league_id
    JOIN public.tournament_pairs pair ON pair.id IN (m.pair_one_id,m.pair_two_id) AND pair.league_team_id IS NOT NULL
    WHERE m.status IN ('completed','bye') AND (p_before IS NULL OR (e.starts_at,e.id)<(p_before,p_before_event))
  ), scored AS (
    SELECT a.*,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer>(s->>'two')::integer ELSE (s->>'two')::integer>(s->>'one')::integer END),0)::integer AS sets_won,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer<(s->>'two')::integer ELSE (s->>'two')::integer<(s->>'one')::integer END),0)::integer AS sets_lost,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'one')::integer ELSE (s->>'two')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_won,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'two')::integer ELSE (s->>'one')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_lost
    FROM appearances a
  ), stats AS (
    SELECT t.id AS team_id,t.player_one_id,t.player_two_id,
      coalesce(sum(CASE WHEN s.status='bye' THEN coalesce((config.cfg->'league_points'->>'bye')::integer,0)
        WHEN s.status='completed' AND s.winner_side IS NULL THEN coalesce((config.cfg->'league_points'->>'draw')::integer,0)
        WHEN s.status='completed' AND s.winner_side=s.side THEN coalesce((config.cfg->'league_points'->>'win')::integer,3)
        WHEN s.status='completed' THEN coalesce((config.cfg->'league_points'->>'loss')::integer,0) ELSE 0 END),0)::integer AS points,
      count(*) FILTER (WHERE s.status='completed')::integer AS played,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side=s.side)::integer AS wins,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side IS NOT NULL AND s.winner_side<>s.side)::integer AS losses,
      coalesce(sum(s.sets_won),0)::integer AS sets_won,coalesce(sum(s.sets_lost),0)::integer AS sets_lost,
      coalesce(sum(s.games_won),0)::integer AS games_won,coalesce(sum(s.games_lost),0)::integer AS games_lost
    FROM public.league_teams t CROSS JOIN config LEFT JOIN scored s ON s.team_id=t.id
    WHERE t.league_id=p_league_id AND t.status='active' AND t.confirmed_at IS NOT NULL
      AND (p_before IS NULL OR t.confirmed_at<p_before)
    GROUP BY t.id,t.player_one_id,t.player_two_id,config.cfg
  ), ordered AS (
    SELECT stats.*, ARRAY(SELECT CASE metric
      WHEN 'points' THEN stats.points WHEN 'matches_won' THEN stats.wins WHEN 'matches_played' THEN stats.played
      WHEN 'sets_won' THEN stats.sets_won WHEN 'sets_lost' THEN stats.sets_lost WHEN 'set_difference' THEN stats.sets_won-stats.sets_lost
      WHEN 'games_won' THEN stats.games_won WHEN 'game_difference' THEN stats.games_won-stats.games_lost ELSE 0 END
      FROM unnest((SELECT coalesce(array_agg(value),ARRAY['matches_won','sets_won','games_won']) FROM config c CROSS JOIN LATERAL jsonb_array_elements_text(c.cfg->'ranking_priority') value)) WITH ORDINALITY p(metric,ord) ORDER BY ord) AS rank_values
    FROM stats
  ), ranked AS (SELECT ordered.*,row_number() OVER (ORDER BY rank_values DESC,team_id) AS position FROM ordered)
  SELECT coalesce(jsonb_agg(jsonb_build_object('team_id',r.team_id,'player_one_id',r.player_one_id,'player_two_id',r.player_two_id,
    'team_name',coalesce(nullif(a.full_name,''),'Player')||' + '||coalesce(nullif(b.full_name,''),'Player'),
    'position',r.position,'points',r.points,'matches_played',r.played,'wins',r.wins,'losses',r.losses,
    'sets_won',r.sets_won,'sets_lost',r.sets_lost,'games_won',r.games_won,'games_lost',r.games_lost) ORDER BY r.position),'[]'::jsonb)
  FROM ranked r LEFT JOIN public.profiles a ON a.id=r.player_one_id LEFT JOIN public.profiles b ON b.id=r.player_two_id;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_league_tournament_standings(p_league_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event record; v_config text; v_current jsonb;
BEGIN
  SELECT md5(row_to_json(l)::text) INTO v_config FROM public.social_doubles_ladders l WHERE l.id=p_league_id AND l.competition_type='league';
  IF v_config IS NULL THEN RETURN; END IF;
  FOR v_event IN SELECT id,starts_at FROM public.events WHERE social_doubles_ladder_id=p_league_id ORDER BY starts_at,id LOOP
    INSERT INTO public.league_standings_snapshots(event_id,league_id,standings,configuration_version)
    VALUES(v_event.id,p_league_id,public.league_standings_json(p_league_id,v_event.starts_at,v_event.id),v_config)
    ON CONFLICT(event_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
  END LOOP;
  v_current := public.league_standings_json(p_league_id,NULL,NULL);
  INSERT INTO public.league_current_standings(league_id,standings,configuration_version)
  VALUES(p_league_id,v_current,v_config)
  ON CONFLICT(league_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
END; $$;
REVOKE ALL ON FUNCTION public.league_standings_json(uuid,timestamptz,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.recalculate_league_tournament_standings(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.refresh_league_tournament_standings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid;
BEGIN
  IF TG_TABLE_NAME='social_doubles_ladders' THEN v_league := coalesce((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
  ELSIF TG_TABLE_NAME='events' THEN v_league := coalesce((to_jsonb(NEW)->>'social_doubles_ladder_id')::uuid,(to_jsonb(OLD)->>'social_doubles_ladder_id')::uuid);
  ELSIF TG_TABLE_NAME='league_teams' THEN v_league := coalesce((to_jsonb(NEW)->>'league_id')::uuid,(to_jsonb(OLD)->>'league_id')::uuid);
  ELSE
    SELECT e.social_doubles_ladder_id INTO v_league FROM public.events e WHERE e.id=coalesce((to_jsonb(NEW)->>'event_id')::uuid,(to_jsonb(OLD)->>'event_id')::uuid);
  END IF;
  IF v_league IS NOT NULL THEN PERFORM public.recalculate_league_tournament_standings(v_league); END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS refresh_league_standings_from_matches ON public.tournament_matches;
CREATE TRIGGER refresh_league_standings_from_matches AFTER INSERT OR UPDATE OR DELETE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_pairs ON public.tournament_pairs;
CREATE TRIGGER refresh_league_standings_from_pairs AFTER INSERT OR UPDATE OR DELETE ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_teams ON public.league_teams;
CREATE TRIGGER refresh_league_standings_from_teams AFTER INSERT OR UPDATE OR DELETE ON public.league_teams FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_events ON public.events;
CREATE TRIGGER refresh_league_standings_from_events AFTER INSERT OR UPDATE OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_config ON public.social_doubles_ladders;
CREATE TRIGGER refresh_league_standings_from_config AFTER UPDATE OF tournament_config,gender,starts_at,ends_at ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();

CREATE OR REPLACE FUNCTION public.sync_league_config_to_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.competition_type='league' AND (OLD.tournament_config IS DISTINCT FROM NEW.tournament_config OR OLD.gender IS DISTINCT FROM NEW.gender OR OLD.tournament_rules_html IS DISTINCT FROM NEW.tournament_rules_html) THEN
    UPDATE public.events SET tournament_config=NEW.tournament_config,tournament_rules_html=NEW.tournament_rules_html,gender_restriction=NEW.gender
      WHERE social_doubles_ladder_id=NEW.id AND event_type='tournament';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sync_league_config_to_events ON public.social_doubles_ladders;
CREATE TRIGGER sync_league_config_to_events AFTER UPDATE ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.sync_league_config_to_events();

ALTER TABLE public.league_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_standings_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_current_standings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved members view league teams" ON public.league_teams FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
CREATE POLICY "Approved members view league snapshots" ON public.league_standings_snapshots FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
CREATE POLICY "Public view published league snapshots" ON public.league_standings_snapshots FOR SELECT TO anon USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=league_standings_snapshots.event_id AND e.status='published' AND e.tournament_details_public=true));
CREATE POLICY "Approved members view league current standings" ON public.league_current_standings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
GRANT SELECT ON public.league_teams,public.league_standings_snapshots,public.league_current_standings TO authenticated;
GRANT SELECT ON public.league_standings_snapshots TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_doubles_ladders TO authenticated;

-- Store both pre-event and post-event standings for League event pages.

ALTER TABLE public.league_standings_snapshots ADD COLUMN IF NOT EXISTS standings_after jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz,p_before_event uuid,p_include_event boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH config AS (
    SELECT coalesce(tournament_config,'{}'::jsonb) AS cfg FROM public.social_doubles_ladders WHERE id=p_league_id AND competition_type='league'
  ), appearances AS (
    SELECT m.id AS match_id,m.status,m.winner_side,m.score_sets,m.event_id,
      CASE WHEN m.pair_one_id=pair.id THEN 1 ELSE 2 END AS side,pair.league_team_id AS team_id
    FROM public.tournament_matches m
    JOIN public.events e ON e.id=m.event_id AND e.social_doubles_ladder_id=p_league_id
    JOIN public.tournament_pairs pair ON pair.id IN (m.pair_one_id,m.pair_two_id) AND pair.league_team_id IS NOT NULL
    WHERE m.status IN ('completed','bye') AND ((p_before IS NULL OR (e.starts_at,e.id)<(p_before,p_before_event)) OR (p_include_event AND e.id=p_before_event))
  ), scored AS (
    SELECT a.*,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer>(s->>'two')::integer ELSE (s->>'two')::integer>(s->>'one')::integer END),0)::integer AS sets_won,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer<(s->>'two')::integer ELSE (s->>'two')::integer<(s->>'one')::integer END),0)::integer AS sets_lost,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'one')::integer ELSE (s->>'two')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_won,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'two')::integer ELSE (s->>'one')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_lost
    FROM appearances a
  ), stats AS (
    SELECT t.id AS team_id,t.player_one_id,t.player_two_id,
      coalesce(sum(CASE WHEN s.status='bye' THEN coalesce((config.cfg->'league_points'->>'bye')::integer,0)
        WHEN s.status='completed' AND s.winner_side IS NULL THEN coalesce((config.cfg->'league_points'->>'draw')::integer,0)
        WHEN s.status='completed' AND s.winner_side=s.side THEN coalesce((config.cfg->'league_points'->>'win')::integer,3)
        WHEN s.status='completed' THEN coalesce((config.cfg->'league_points'->>'loss')::integer,0) ELSE 0 END),0)::integer AS points,
      count(*) FILTER (WHERE s.status='completed')::integer AS played,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side=s.side)::integer AS wins,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side IS NOT NULL AND s.winner_side<>s.side)::integer AS losses,
      coalesce(sum(s.sets_won),0)::integer AS sets_won,coalesce(sum(s.sets_lost),0)::integer AS sets_lost,
      coalesce(sum(s.games_won),0)::integer AS games_won,coalesce(sum(s.games_lost),0)::integer AS games_lost
    FROM public.league_teams t CROSS JOIN config LEFT JOIN scored s ON s.team_id=t.id
    WHERE t.league_id=p_league_id AND t.status='active' AND t.confirmed_at IS NOT NULL
      AND (p_before IS NULL OR t.confirmed_at<p_before OR (p_include_event AND EXISTS (SELECT 1 FROM public.tournament_pairs p WHERE p.event_id=p_before_event AND p.league_team_id=t.id AND p.status='active')))
    GROUP BY t.id,t.player_one_id,t.player_two_id,config.cfg
  ), ordered AS (
    SELECT stats.*, ARRAY(SELECT CASE metric
      WHEN 'points' THEN stats.points WHEN 'matches_won' THEN stats.wins WHEN 'matches_played' THEN stats.played
      WHEN 'sets_won' THEN stats.sets_won WHEN 'sets_lost' THEN stats.sets_lost WHEN 'set_difference' THEN stats.sets_won-stats.sets_lost
      WHEN 'games_won' THEN stats.games_won WHEN 'game_difference' THEN stats.games_won-stats.games_lost ELSE 0 END
      FROM unnest((SELECT coalesce(array_agg(value),ARRAY['matches_won','sets_won','games_won']) FROM config c CROSS JOIN LATERAL jsonb_array_elements_text(c.cfg->'ranking_priority') value)) WITH ORDINALITY p(metric,ord) ORDER BY ord) AS rank_values
    FROM stats
  ), ranked AS (SELECT ordered.*,row_number() OVER (ORDER BY rank_values DESC,team_id) AS position FROM ordered)
  SELECT coalesce(jsonb_agg(jsonb_build_object('team_id',r.team_id,'player_one_id',r.player_one_id,'player_two_id',r.player_two_id,
    'team_name',coalesce(nullif(a.full_name,''),'Player')||' + '||coalesce(nullif(b.full_name,''),'Player'),
    'position',r.position,'points',r.points,'matches_played',r.played,'wins',r.wins,'losses',r.losses,
    'sets_won',r.sets_won,'sets_lost',r.sets_lost,'games_won',r.games_won,'games_lost',r.games_lost) ORDER BY r.position),'[]'::jsonb)
  FROM ranked r LEFT JOIN public.profiles a ON a.id=r.player_one_id LEFT JOIN public.profiles b ON b.id=r.player_two_id;
$$;

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz DEFAULT NULL,p_before_event uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.league_standings_json(p_league_id,p_before,p_before_event,false);
$$;

REVOKE ALL ON FUNCTION public.league_standings_json(uuid,timestamptz,uuid,boolean) FROM PUBLIC,anon;

CREATE OR REPLACE FUNCTION public.recalculate_league_tournament_standings(p_league_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event record; v_config text; v_current jsonb;
BEGIN
  SELECT md5(row_to_json(l)::text) INTO v_config FROM public.social_doubles_ladders l WHERE l.id=p_league_id AND l.competition_type='league';
  IF v_config IS NULL THEN RETURN; END IF;
  FOR v_event IN SELECT id,starts_at FROM public.events WHERE social_doubles_ladder_id=p_league_id ORDER BY starts_at,id LOOP
    INSERT INTO public.league_standings_snapshots(event_id,league_id,standings,standings_after,configuration_version)
    VALUES(v_event.id,p_league_id,public.league_standings_json(p_league_id,v_event.starts_at,v_event.id),public.league_standings_json(p_league_id,v_event.starts_at,v_event.id,true),v_config)
    ON CONFLICT(event_id) DO UPDATE SET standings=EXCLUDED.standings,standings_after=EXCLUDED.standings_after,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
  END LOOP;
  v_current := public.league_standings_json(p_league_id,NULL,NULL);
  INSERT INTO public.league_current_standings(league_id,standings,configuration_version)
  VALUES(p_league_id,v_current,v_config)
  ON CONFLICT(league_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
END; $$;

-- Allow fixed League team members to report the score of their scheduled match.

CREATE OR REPLACE FUNCTION public.submit_league_match_score(
  p_match_id uuid,
  p_score_one integer,
  p_score_two integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_league_id uuid;
  v_pair_one uuid;
  v_pair_two uuid;
BEGIN
  IF auth.uid() IS NULL OR p_score_one IS NULL OR p_score_two IS NULL
    OR p_score_one < 0 OR p_score_two < 0 OR p_score_one = p_score_two THEN
    RAISE EXCEPTION 'Enter two different non-negative scores';
  END IF;

  SELECT e.id,e.starts_at,e.social_doubles_ladder_id,m.status,m.pair_one_id,m.pair_two_id
    INTO v_event_id,v_starts_at,v_league_id,v_status,v_pair_one,v_pair_two
  FROM public.tournament_matches m
  JOIN public.events e ON e.id=m.event_id
  JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE m.id=p_match_id AND e.event_type='tournament' AND e.tournament_format='doubles'
    AND m.phase='round_robin' AND m.pair_one_id IS NOT NULL AND m.pair_two_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'League match not found'; END IF;
  IF now() < v_starts_at OR now() - v_starts_at > interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event start';
  END IF;
  IF v_status='cancelled' THEN RAISE EXCEPTION 'This match was cancelled'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournament_pairs pair
    JOIN public.league_teams team ON team.id=pair.league_team_id AND team.league_id=v_league_id AND team.status='active'
    JOIN public.tournament_participants player ON player.id IN (pair.player_one_id,pair.player_two_id)
    WHERE pair.id IN (v_pair_one,v_pair_two) AND pair.event_id=v_event_id AND pair.status='active'
      AND player.user_id=auth.uid()
      AND player.user_id IN (team.player_one_id,team.player_two_id)
  ) THEN
    RAISE EXCEPTION 'Only players in these fixed League teams can submit the match score';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets=jsonb_build_array(jsonb_build_object('one',p_score_one,'two',p_score_two)),
      winner_side=CASE WHEN p_score_one > p_score_two THEN 1 ELSE 2 END,
      status='completed',
      team_points_one=CASE WHEN p_score_one > p_score_two THEN 3 ELSE 0 END,
      team_points_two=CASE WHEN p_score_two > p_score_one THEN 3 ELSE 0 END,
      entered_by=auth.uid(),
      updated_at=now()
  WHERE id=p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_league_match_score(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_league_match_score(uuid,integer,integer) TO authenticated;


-- Qualify both participant tables because this trigger runs with an empty search_path.
CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,public.tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two) AND p.application_status<>'approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- League teams begin when the first pair is created; replacements update the team series-wide.

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,public.tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two) AND p.application_status<>'approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after the pair is created';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    VALUES(v_league,v_one,v_two) RETURNING * INTO v_member_team;
    NEW.league_team_id := v_member_team.id;
  END IF;
  RETURN NEW;
END; $$;

-- Give existing unlinked League pairs the same fixed-team behavior after upgrade.
INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
SELECT DISTINCT ON (e.social_doubles_ladder_id,least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id))
  e.social_doubles_ladder_id,p1.user_id,p2.user_id
FROM public.tournament_pairs pair
JOIN public.events e ON e.id=pair.event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
JOIN public.social_doubles_ladders league ON league.id=e.social_doubles_ladder_id AND league.competition_type='league'
JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
WHERE pair.status='active' AND pair.league_team_id IS NULL AND p1.user_id IS NOT NULL AND p2.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=e.social_doubles_ladder_id AND t.status='active'
    AND (t.player_one_id IN (p1.user_id,p2.user_id) OR t.player_two_id IN (p1.user_id,p2.user_id)))
ORDER BY e.social_doubles_ladder_id,least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id),pair.created_at,pair.id;

UPDATE public.tournament_pairs pair SET league_team_id=team.id
FROM public.events e,public.tournament_participants p1,public.tournament_participants p2,public.league_teams team
WHERE pair.league_team_id IS NULL AND pair.status='active' AND e.id=pair.event_id
  AND e.social_doubles_ladder_id=team.league_id AND team.status='active'
  AND p1.id=pair.player_one_id AND p2.id=pair.player_two_id
  AND ((team.player_one_id=p1.user_id AND team.player_two_id=p2.user_id)
    OR (team.player_one_id=p2.user_id AND team.player_two_id=p1.user_id));

DROP FUNCTION IF EXISTS public.confirm_league_tournament_teams(uuid);

CREATE OR REPLACE FUNCTION public.replace_league_team_member(
  p_event_id uuid,
  p_pair_id uuid,
  p_side integer,
  p_replacement_participant_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_league_id uuid;
  v_team_id uuid;
  v_event_start timestamptz;
  v_old_user uuid;
  v_new_user uuid;
  v_category text;
BEGIN
  IF p_side NOT IN (1,2) THEN RAISE EXCEPTION 'Pair side must be 1 or 2'; END IF;
  SELECT e.social_doubles_ladder_id,e.starts_at,p.league_team_id,p.category,
    old_player.user_id,replacement.user_id
  INTO v_league_id,v_event_start,v_team_id,v_category,v_old_user,v_new_user
  FROM public.events e
  JOIN public.tournament_pairs p ON p.event_id=e.id AND p.id=p_pair_id AND p.status='active'
  JOIN public.tournament_participants old_player ON old_player.id=CASE WHEN p_side=1 THEN p.player_one_id ELSE p.player_two_id END
  JOIN public.tournament_participants replacement ON replacement.id=p_replacement_participant_id AND replacement.event_id=e.id AND replacement.status='registered'
  WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles';

  IF v_league_id IS NULL OR v_team_id IS NULL OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF v_old_user IS NULL OR v_new_user IS NULL OR v_new_user=v_old_user THEN
    RAISE EXCEPTION 'Select a different registered replacement player';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_new_user AND p.application_status='approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league_id AND t.status='active' AND t.id<>v_team_id
    AND v_new_user IN (t.player_one_id,t.player_two_id)) THEN
    RAISE EXCEPTION 'Replacement player already belongs to another active league team';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_pairs p
    JOIN public.events e ON e.id=p.event_id AND e.social_doubles_ladder_id=v_league_id
    JOIN public.tournament_participants member ON member.id IN (p.player_one_id,p.player_two_id)
    WHERE p.status='active' AND p.league_team_id=v_team_id AND e.starts_at>=v_event_start
      AND member.user_id=v_new_user AND p.id<>p_pair_id) THEN
    RAISE EXCEPTION 'Replacement player is already assigned to another League pair';
  END IF;

  UPDATE public.league_teams
  SET player_one_id=CASE WHEN p_side=1 THEN v_new_user ELSE player_one_id END,
      player_two_id=CASE WHEN p_side=2 THEN v_new_user ELSE player_two_id END
  WHERE id=v_team_id AND league_id=v_league_id AND status='active';

  -- Update this and later event pairs where the replacement has a registration.
  -- Completed match-player rows remain untouched, preserving each player's prior match history.
  WITH replacement_rows AS (
    SELECT pair.id AS pair_id,pair.event_id,replacement.id AS participant_id,old_member.id AS old_participant_id
    FROM public.tournament_pairs pair
    JOIN public.events e ON e.id=pair.event_id AND e.social_doubles_ladder_id=v_league_id AND e.starts_at>=v_event_start
    JOIN public.tournament_participants old_member ON old_member.id=CASE WHEN p_side=1 THEN pair.player_one_id ELSE pair.player_two_id END
    JOIN public.tournament_participants replacement ON replacement.event_id=pair.event_id AND replacement.user_id=v_new_user
      AND replacement.category=v_category AND replacement.status='registered'
    WHERE pair.league_team_id=v_team_id AND pair.status='active'
      AND old_member.user_id=v_old_user
  ), changed AS (
    UPDATE public.tournament_pairs pair
    SET player_one_id=CASE WHEN p_side=1 THEN replacement_rows.participant_id ELSE pair.player_one_id END,
        player_two_id=CASE WHEN p_side=2 THEN replacement_rows.participant_id ELSE pair.player_two_id END
    FROM replacement_rows WHERE pair.id=replacement_rows.pair_id
    RETURNING pair.event_id,replacement_rows.old_participant_id,replacement_rows.participant_id
  )
  UPDATE public.tournament_participants old_participant
  SET status='replaced',replaced_by=changed.participant_id,updated_at=now()
  FROM changed WHERE old_participant.id=changed.old_participant_id;

  UPDATE public.tournament_match_players match_player
  SET participant_id=CASE WHEN p_side=1 THEN pair.player_one_id ELSE pair.player_two_id END
  FROM public.tournament_matches match
  JOIN public.tournament_pairs pair ON pair.event_id=match.event_id
  JOIN public.events event ON event.id=pair.event_id AND event.social_doubles_ladder_id=v_league_id AND event.starts_at>=v_event_start
  WHERE match_player.match_id=match.id AND match.status NOT IN ('completed','cancelled')
    AND pair.league_team_id=v_team_id AND pair.status='active'
    AND match_player.side=CASE WHEN match.pair_one_id=pair.id THEN 1 ELSE 2 END
    AND (match.pair_one_id=pair.id OR match.pair_two_id=pair.id)
    AND match_player.participant_id IN (
      SELECT old_member.id FROM public.tournament_participants old_member
      WHERE old_member.event_id=pair.event_id AND old_member.user_id=v_old_user
    );
END; $$;

REVOKE ALL ON FUNCTION public.replace_league_team_member(uuid,uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_league_team_member(uuid,uuid,integer,uuid) TO authenticated;


-- Store court assignments as fixed League pairs (two players per team).

CREATE TABLE IF NOT EXISTS public.league_event_court_assignments (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  pair_id uuid NOT NULL REFERENCES public.tournament_pairs(id) ON DELETE CASCADE,
  court_number integer NOT NULL CHECK (court_number BETWEEN 1 AND 4),
  segment_order integer NOT NULL DEFAULT 1 CHECK (segment_order BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id,pair_id,segment_order),
  FOREIGN KEY (event_id,pair_id) REFERENCES public.tournament_pairs(event_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS league_event_court_assignments_slot_idx
  ON public.league_event_court_assignments(event_id,segment_order,court_number);
ALTER TABLE public.league_event_court_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "League court assignments are public" ON public.league_event_court_assignments;
CREATE POLICY "League court assignments are public" ON public.league_event_court_assignments
  FOR SELECT TO anon,authenticated USING (EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=league_event_court_assignments.event_id AND e.status='published'
  ));
DROP POLICY IF EXISTS "Event managers manage League court assignments" ON public.league_event_court_assignments;
CREATE POLICY "Event managers manage League court assignments" ON public.league_event_court_assignments
  FOR ALL TO authenticated USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT ON public.league_event_court_assignments TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.league_event_court_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.save_league_event_court_assignments(p_event_id uuid,p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expected integer; v_count integer; v_invalid boolean;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
      AND l.competition_type='league' AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF jsonb_typeof(p_assignments)<>'array' THEN RAISE EXCEPTION 'Court assignments must be an array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_assignments);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    WHERE (item->>'court_number')::integer NOT BETWEEN 1 AND 4
      OR (item->>'segment_order')::integer NOT BETWEEN 1 AND 4
      OR NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair
        WHERE pair.id=(item->>'pair_id')::uuid AND pair.event_id=p_event_id AND pair.status='active'
          AND pair.league_team_id IS NOT NULL)
  ) INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Assignments must use active League teams and valid courts'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'pair_id'),(item->>'segment_order') HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'A League team can only be assigned once per slot'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'segment_order'),(item->>'court_number') HAVING count(*)>2
  ) THEN RAISE EXCEPTION 'Each court can hold two League teams per slot'; END IF;
  SELECT count(*) INTO v_expected FROM public.tournament_pairs pair
  WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL;
  IF v_expected>0 AND (v_count=0 OR v_count % v_expected<>0) THEN
    RAISE EXCEPTION 'Assign every active League team once in each slot';
  END IF;
  IF v_expected>0 AND EXISTS (
    SELECT 1 FROM generate_series(1,greatest(1,(SELECT max((item->>'segment_order')::integer)
      FROM jsonb_array_elements(p_assignments) item))) slots(slot)
    CROSS JOIN public.tournament_pairs pair
    WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'pair_id')::uuid=pair.id AND (item->>'segment_order')::integer=slots.slot)
  ) THEN RAISE EXCEPTION 'Assign every active League team once in each slot'; END IF;

  DELETE FROM public.league_event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.league_event_court_assignments(event_id,pair_id,court_number,segment_order)
  SELECT p_event_id,(item->>'pair_id')::uuid,(item->>'court_number')::integer,(item->>'segment_order')::integer
  FROM jsonb_array_elements(p_assignments) item;
END; $$;

REVOKE ALL ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) TO authenticated;


-- Use active membership as the League pair eligibility rule and expose it to the admin selector.

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,public.tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two)
      AND (p.application_status<>'approved' OR NOT public.has_active_paid_membership(p.id))
  ) THEN
    RAISE EXCEPTION 'League teams require players with active paid membership';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after the pair is created';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    VALUES(v_league,v_one,v_two) RETURNING * INTO v_member_team;
    NEW.league_team_id := v_member_team.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.league_event_pair_eligibility(p_event_id uuid)
RETURNS TABLE(participant_id uuid,eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND l.competition_type='league'
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  RETURN QUERY
  SELECT participant.id,
    (profile.application_status='approved' AND public.has_active_paid_membership(profile.id))
  FROM public.tournament_participants participant
  JOIN public.profiles profile ON profile.id=participant.user_id
  WHERE participant.event_id=p_event_id AND participant.status='registered';
END; $$;

REVOKE ALL ON FUNCTION public.league_event_pair_eligibility(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.league_event_pair_eligibility(uuid) TO authenticated;


-- Return eligibility for every member in the admin participant selector, not only current entrants.

DROP FUNCTION IF EXISTS public.league_event_pair_eligibility(uuid);
CREATE FUNCTION public.league_event_pair_eligibility(p_event_id uuid)
RETURNS TABLE(user_id uuid,eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND l.competition_type='league'
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  RETURN QUERY
  SELECT profile.id,
    (profile.application_status='approved' AND public.has_active_paid_membership(profile.id))
  FROM public.profiles profile;
END; $$;

REVOKE ALL ON FUNCTION public.league_event_pair_eligibility(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.league_event_pair_eligibility(uuid) TO authenticated;


-- Let event managers confirm over-capacity League court assignments in the UI.
ALTER TABLE public.league_event_court_assignments
  DROP CONSTRAINT IF EXISTS league_event_court_assignments_segment_order_check;
ALTER TABLE public.league_event_court_assignments
  ADD CONSTRAINT league_event_court_assignments_segment_order_check CHECK (segment_order>=1);

CREATE OR REPLACE FUNCTION public.save_league_event_court_assignments(p_event_id uuid,p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expected integer; v_count integer; v_invalid boolean;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
      AND l.competition_type='league' AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF jsonb_typeof(p_assignments)<>'array' THEN RAISE EXCEPTION 'Court assignments must be an array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_assignments);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    WHERE (item->>'court_number')::integer NOT BETWEEN 1 AND 4
      OR (item->>'segment_order')::integer<1
      OR NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair
        WHERE pair.id=(item->>'pair_id')::uuid AND pair.event_id=p_event_id AND pair.status='active'
          AND pair.league_team_id IS NOT NULL)
  ) INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Assignments must use active League teams and valid courts'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'pair_id'),(item->>'segment_order') HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'A League team can only be assigned once per slot'; END IF;
  SELECT count(*) INTO v_expected FROM public.tournament_pairs pair
  WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL;
  IF v_expected>0 AND (v_count=0 OR v_count % v_expected<>0) THEN
    RAISE EXCEPTION 'Assign every active League team once in each slot';
  END IF;
  IF v_expected>0 AND EXISTS (
    SELECT 1 FROM generate_series(1,greatest(1,(SELECT max((item->>'segment_order')::integer)
      FROM jsonb_array_elements(p_assignments) item))) slots(slot)
    CROSS JOIN public.tournament_pairs pair
    WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'pair_id')::uuid=pair.id AND (item->>'segment_order')::integer=slots.slot)
  ) THEN RAISE EXCEPTION 'Assign every active League team once in each slot'; END IF;

  DELETE FROM public.league_event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.league_event_court_assignments(event_id,pair_id,court_number,segment_order)
  SELECT p_event_id,(item->>'pair_id')::uuid,(item->>'court_number')::integer,(item->>'segment_order')::integer
  FROM jsonb_array_elements(p_assignments) item;
END; $$;

-- Allow approved event managers to enter/correct League scores while retaining
-- the existing two-day window for ordinary fixed-team members.

CREATE OR REPLACE FUNCTION public.submit_league_match_score(
  p_match_id uuid,
  p_score_one integer,
  p_score_two integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_league_id uuid;
  v_pair_one uuid;
  v_pair_two uuid;
  v_organizer_id uuid;
  v_created_by uuid;
  v_is_manager boolean := false;
BEGIN
  IF auth.uid() IS NULL OR p_score_one IS NULL OR p_score_two IS NULL
    OR p_score_one < 0 OR p_score_two < 0 OR p_score_one = p_score_two THEN
    RAISE EXCEPTION 'Enter two different non-negative scores';
  END IF;

  SELECT e.id,e.starts_at,e.social_doubles_ladder_id,m.status,m.pair_one_id,m.pair_two_id,
         e.organizer_id,e.created_by
    INTO v_event_id,v_starts_at,v_league_id,v_status,v_pair_one,v_pair_two,
         v_organizer_id,v_created_by
  FROM public.tournament_matches m
  JOIN public.events e ON e.id=m.event_id
  JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE m.id=p_match_id AND e.event_type='tournament' AND e.tournament_format='doubles'
    AND m.phase='round_robin' AND m.pair_one_id IS NOT NULL AND m.pair_two_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'League match not found'; END IF;
  IF v_status='cancelled' THEN RAISE EXCEPTION 'This match was cancelled'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.application_status='approved'
      AND (p.role='admin' OR (p.role='organizer' AND COALESCE(v_organizer_id,v_created_by)=auth.uid()))
  ) INTO v_is_manager;

  IF NOT v_is_manager AND now() < v_starts_at THEN
    RAISE EXCEPTION 'Scores cannot be entered before the event start time';
  END IF;
  IF NOT v_is_manager AND now() - v_starts_at > interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event start';
  END IF;

  IF NOT v_is_manager AND NOT EXISTS (
    SELECT 1
    FROM public.tournament_pairs pair
    JOIN public.league_teams team ON team.id=pair.league_team_id
      AND team.league_id=v_league_id AND team.status='active'
    JOIN public.tournament_participants player ON player.id IN (pair.player_one_id,pair.player_two_id)
    WHERE pair.id IN (v_pair_one,v_pair_two) AND pair.event_id=v_event_id AND pair.status='active'
      AND player.user_id=auth.uid()
      AND player.user_id IN (team.player_one_id,team.player_two_id)
  ) THEN
    RAISE EXCEPTION 'Only players in these fixed League teams or approved event managers can submit the match score';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets=jsonb_build_array(jsonb_build_object('one',p_score_one,'two',p_score_two)),
      winner_side=CASE WHEN p_score_one > p_score_two THEN 1 ELSE 2 END,
      status='completed',
      team_points_one=CASE WHEN p_score_one > p_score_two THEN 3 ELSE 0 END,
      team_points_two=CASE WHEN p_score_two > p_score_one THEN 3 ELSE 0 END,
      entered_by=auth.uid(),
      updated_at=now()
  WHERE id=p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_league_match_score(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_league_match_score(uuid,integer,integer) TO authenticated;


-- Turn each court/sub-session containing exactly two assigned League teams
-- Turn each court/sub-session containing exactly two assigned League teams
-- into a normal tournament match so the existing score and standings pipeline
-- can be used without a parallel score store.

CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_league_assignment_slot_unique
  ON public.tournament_matches(event_id, match_number)
  WHERE notes = 'league-court-assignment';

CREATE OR REPLACE FUNCTION public.save_league_event_court_assignments(p_event_id uuid,p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_invalid boolean;
  v_expected integer;
  v_max_segment integer;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
      AND l.competition_type='league' AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF jsonb_typeof(p_assignments)<>'array' THEN RAISE EXCEPTION 'Court assignments must be an array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_assignments);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    WHERE (item->>'court_number')::integer NOT BETWEEN 1 AND 4
      OR (item->>'segment_order')::integer NOT BETWEEN 1 AND 4
      OR NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair
        WHERE pair.id=(item->>'pair_id')::uuid AND pair.event_id=p_event_id AND pair.status='active'
          AND pair.league_team_id IS NOT NULL)
  ) INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Assignments must use active League teams and valid courts'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'pair_id'),(item->>'segment_order') HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'A League team can only be assigned once per slot'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'segment_order'),(item->>'court_number') HAVING count(*)>2
  ) THEN RAISE EXCEPTION 'Each court can hold two League teams per slot'; END IF;
  SELECT count(*) INTO v_expected FROM public.tournament_pairs pair
  WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL;
  IF v_expected>0 AND (v_count=0 OR v_count % v_expected<>0) THEN
    RAISE EXCEPTION 'Assign every active League team once in each slot';
  END IF;
  SELECT coalesce(max((item->>'segment_order')::integer),1) INTO v_max_segment
  FROM jsonb_array_elements(p_assignments) item;
  IF v_expected>0 AND EXISTS (
    SELECT 1 FROM generate_series(1,v_max_segment) slots(slot)
    CROSS JOIN public.tournament_pairs pair
    WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'pair_id')::uuid=pair.id AND (item->>'segment_order')::integer=slots.slot)
  ) THEN RAISE EXCEPTION 'Assign every active League team once in each sub-session'; END IF;

  -- Do not silently discard a result if an administrator changes a completed matchup.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_matches m
    JOIN LATERAL (
      SELECT (array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid))[1] AS pair_one_id,
             (array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid))[2] AS pair_two_id
      FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'segment_order')::integer=(((m.match_number-1)/10)+1)
        AND (item->>'court_number')::integer=(((m.match_number-1)%10)+1)
    ) proposed ON true
    WHERE m.event_id=p_event_id AND m.notes='league-court-assignment' AND m.status='completed'
      AND (m.pair_one_id IS DISTINCT FROM proposed.pair_one_id OR m.pair_two_id IS DISTINCT FROM proposed.pair_two_id)
  ) THEN RAISE EXCEPTION 'A completed League match cannot be reassigned. Correct or remove its score first.'; END IF;

  DELETE FROM public.league_event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.league_event_court_assignments(event_id,pair_id,court_number,segment_order)
  SELECT p_event_id,(item->>'pair_id')::uuid,(item->>'court_number')::integer,(item->>'segment_order')::integer
  FROM jsonb_array_elements(p_assignments) item;

  -- One normal tournament_matches row for every full court (two teams) in each slot.
  INSERT INTO public.tournament_matches(
    event_id,category,phase,group_number,round_number,match_number,
    pair_one_id,pair_two_id,scheduled_at,court_number,status,notes
  )
  SELECT p_event_id, pair_one.category, 'round_robin', NULL, slot.segment_order,
         (slot.segment_order-1)*10+slot.court_number,
         pair_one.id, pair_two.id,
         e.starts_at + ((coalesce(extract(epoch FROM (e.ends_at-e.starts_at)),3600) / greatest(v_max_segment,1))
           * (slot.segment_order-1)) * interval '1 second',
         slot.court_number, 'scheduled', 'league-court-assignment'
  FROM (
    SELECT (item->>'segment_order')::integer AS segment_order,
           (item->>'court_number')::integer AS court_number,
           array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid) AS pair_ids
    FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'segment_order')::integer,(item->>'court_number')::integer
    HAVING count(*)=2
  ) slot
  JOIN public.tournament_pairs pair_one ON pair_one.id=slot.pair_ids[1]
  JOIN public.tournament_pairs pair_two ON pair_two.id=slot.pair_ids[2]
  JOIN public.events e ON e.id=p_event_id
  ON CONFLICT (event_id,match_number) WHERE notes='league-court-assignment'
  DO UPDATE SET
    category=EXCLUDED.category,
    pair_one_id=EXCLUDED.pair_one_id,
    pair_two_id=EXCLUDED.pair_two_id,
    scheduled_at=EXCLUDED.scheduled_at,
    court_number=EXCLUDED.court_number,
    round_number=EXCLUDED.round_number,
    updated_at=now()
  WHERE public.tournament_matches.status<>'completed';

  -- Remove obsolete, unplayed generated matches when assignments are removed or moved.
  DELETE FROM public.tournament_matches m
  WHERE m.event_id=p_event_id AND m.notes='league-court-assignment' AND m.status<>'completed'
    AND NOT EXISTS (
      SELECT 1 FROM public.league_event_court_assignments a1
      JOIN public.league_event_court_assignments a2
        ON a2.event_id=a1.event_id AND a2.segment_order=a1.segment_order
       AND a2.court_number=a1.court_number AND a2.pair_id<>a1.pair_id
      WHERE a1.event_id=m.event_id
        AND (a1.segment_order-1)*10+a1.court_number=m.match_number
    );
END; $$;

REVOKE ALL ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) TO authenticated;

-- Backfill matches for assignments that were saved before this migration.
DO $$
DECLARE v_event record; v_max_segment integer;
BEGIN
  FOR v_event IN
    SELECT DISTINCT a.event_id FROM public.league_event_court_assignments a
  LOOP
    SELECT greatest(1,max(segment_order)) INTO v_max_segment
    FROM public.league_event_court_assignments WHERE event_id=v_event.event_id;
    INSERT INTO public.tournament_matches(
      event_id,category,phase,group_number,round_number,match_number,
      pair_one_id,pair_two_id,scheduled_at,court_number,status,notes
    )
    SELECT a.event_id,p1.category,'round_robin',NULL,a.segment_order,
           (a.segment_order-1)*10+a.court_number,p1.id,p2.id,
           e.starts_at + ((coalesce(extract(epoch FROM (e.ends_at-e.starts_at)),3600) / greatest(v_max_segment,1))
             * (a.segment_order-1)) * interval '1 second',
           a.court_number,'scheduled','league-court-assignment'
    FROM (
      SELECT event_id,segment_order,court_number,
             (array_agg(pair_id ORDER BY pair_id))[1] AS pair_one_id,
             (array_agg(pair_id ORDER BY pair_id))[2] AS pair_two_id
      FROM public.league_event_court_assignments
      WHERE event_id=v_event.event_id
      GROUP BY event_id,segment_order,court_number HAVING count(*)=2
    ) a
    JOIN public.tournament_pairs p1 ON p1.id=a.pair_one_id
    JOIN public.tournament_pairs p2 ON p2.id=a.pair_two_id
    JOIN public.events e ON e.id=a.event_id
    ON CONFLICT (event_id,match_number) WHERE notes='league-court-assignment' DO NOTHING;
  END LOOP;
END $$;


-- Register an established League team together and create its event pair atomically.

CREATE OR REPLACE FUNCTION public.register_league_event_team(p_event_id uuid,p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_league public.social_doubles_ladders%rowtype;
  v_team public.league_teams%rowtype;
  v_profile_one public.profiles%rowtype;
  v_profile_two public.profiles%rowtype;
  v_category text;
  v_amount integer;
  v_one_participant uuid;
  v_two_participant uuid;
  v_pair_id uuid;
  v_manager boolean;
BEGIN
  IF v_actor IS NULL OR p_member_id IS NULL THEN RAISE EXCEPTION 'Sign in to register a League team'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
    WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
  IF NOT FOUND OR v_event.tournament_format<>'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;

  v_manager := public.is_event_manager() AND EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND (public.is_admin() OR e.organizer_id=v_actor OR e.created_by=v_actor)
  );
  IF v_actor<>p_member_id AND NOT v_manager THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF v_event.status<>'published' THEN RAISE EXCEPTION 'League event registration is unavailable'; END IF;
  IF NOT v_manager AND (now()<v_event.registration_opens_at
      OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at)
      OR now()>=v_event.starts_at) THEN RAISE EXCEPTION 'League event registration is closed'; END IF;

  SELECT * INTO v_team FROM public.league_teams t
    WHERE t.league_id=v_league.id AND t.status='active'
      AND p_member_id IN (t.player_one_id,t.player_two_id)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed League team was found for this member'; END IF;
  SELECT * INTO v_profile_one FROM public.profiles WHERE id=v_team.player_one_id;
  SELECT * INTO v_profile_two FROM public.profiles WHERE id=v_team.player_two_id;
  IF v_profile_one.application_status<>'approved' OR v_profile_two.application_status<>'approved'
     OR NOT public.has_active_paid_membership(v_team.player_one_id)
     OR NOT public.has_active_paid_membership(v_team.player_two_id) THEN
    RAISE EXCEPTION 'Both League players need approved profiles and active paid memberships';
  END IF;

  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  SELECT pair.id,
    CASE WHEN p1.user_id=v_team.player_one_id THEN p1.id ELSE p2.id END,
    CASE WHEN p1.user_id=v_team.player_two_id THEN p1.id ELSE p2.id END
    INTO v_pair_id,v_one_participant,v_two_participant
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
  JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.league_team_id=v_team.id AND pair.status='active'
    AND p1.status='registered' AND p2.status='registered'
    AND ((p1.user_id=v_team.player_one_id AND p2.user_id=v_team.player_two_id)
      OR (p1.user_id=v_team.player_two_id AND p2.user_id=v_team.player_one_id));
  IF FOUND THEN
    RETURN jsonb_build_object('participantId',v_one_participant,'partnerParticipantId',v_two_participant,
      'pairId',v_pair_id,'amountCents',0,'paymentStatus','paid','alreadyRegistered',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.event_id=p_event_id
       AND p.user_id IN (v_team.player_one_id,v_team.player_two_id) AND p.status='registered') THEN
    RAISE EXCEPTION 'League team has an incomplete registration; contact the event organizer';
  END IF;
  IF NOT v_manager AND (SELECT count(*) FROM public.tournament_participants p
      WHERE p.event_id=p_event_id AND p.status='registered')+2>v_event.capacity THEN
    RAISE EXCEPTION 'League event does not have room for both players';
  END IF;

  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
  VALUES(p_event_id,v_team.player_one_id,v_category,
    coalesce(nullif(v_profile_one.full_name,''),v_profile_one.email),v_profile_one.email,v_profile_one.phone,
    v_profile_one.gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_one_participant;
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
  VALUES(p_event_id,v_team.player_two_id,v_category,
    coalesce(nullif(v_profile_two.full_name,''),v_profile_two.email),v_profile_two.email,v_profile_two.phone,
    v_profile_two.gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_two_participant;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id,league_team_id)
  VALUES(p_event_id,v_category,v_one_participant,v_two_participant,v_team.id)
  RETURNING id INTO v_pair_id;

  RETURN jsonb_build_object('participantId',v_one_participant,'partnerParticipantId',v_two_participant,
    'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,
    'alreadyRegistered',false);
END; $$;

REVOKE ALL ON FUNCTION public.register_league_event_team(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_event_team(uuid,uuid) TO authenticated;


-- Withdraw both participants and their League pair as one operation.

CREATE OR REPLACE FUNCTION public.withdraw_league_event_team(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_pair record;
  v_team public.league_teams%rowtype;
  v_updated integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to withdraw a League team'; END IF;
  SELECT pair.id,pair.league_team_id,pair.player_one_id,pair.player_two_id,
    p1.user_id AS player_one_user_id,p2.user_id AS player_two_user_id,p1.event_id
    INTO v_pair
  FROM public.tournament_participants selected
  JOIN public.tournament_pairs pair ON pair.event_id=selected.event_id
    AND pair.status='active' AND selected.id IN (pair.player_one_id,pair.player_two_id)
  JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id AND p1.status='registered'
  JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id AND p2.status='registered'
  WHERE selected.id=p_participant_id AND selected.user_id=v_actor AND selected.status='registered'
  FOR UPDATE OF pair,p1,p2;
  IF NOT FOUND OR v_pair.league_team_id IS NULL THEN RAISE EXCEPTION 'Active League team registration not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_pair.event_id;
  IF now() >= coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The withdrawal cutoff has passed';
  END IF;
  SELECT * INTO v_team FROM public.league_teams
    WHERE id=v_pair.league_team_id AND status='active' FOR UPDATE;
  IF NOT FOUND OR NOT (
    (v_team.player_one_id=v_pair.player_one_user_id AND v_team.player_two_id=v_pair.player_two_user_id)
    OR (v_team.player_one_id=v_pair.player_two_user_id AND v_team.player_two_id=v_pair.player_one_user_id)
  ) THEN RAISE EXCEPTION 'Confirmed League team could not be verified'; END IF;

  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now()
    WHERE id IN (v_pair.player_one_id,v_pair.player_two_id) AND status='registered';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>2 THEN RAISE EXCEPTION 'Both League players must be registered to withdraw the team'; END IF;
  UPDATE public.tournament_pairs SET status='withdrawn'
    WHERE id=v_pair.id AND status='active';
END; $$;

REVOKE ALL ON FUNCTION public.withdraw_league_event_team(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_league_event_team(uuid) TO authenticated;


-- Let an approved member without an established League team register for a later event alone.

CREATE OR REPLACE FUNCTION public.register_league_single_event_entry(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_league public.social_doubles_ladders%rowtype;
  v_profile public.profiles%rowtype;
  v_category text;
  v_participant_id uuid;
  v_amount integer;
  v_payment_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in with an approved member account to register for a League event'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
    WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
  IF NOT FOUND OR v_event.tournament_format<>'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;
  IF v_event.status<>'published' OR now()<v_event.registration_opens_at
     OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at)
     OR now()>=v_event.starts_at THEN RAISE EXCEPTION 'League event registration is closed'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND application_status='approved';
  IF NOT FOUND OR NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An approved profile and active paid membership are required for League registration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams team WHERE team.league_id=v_league.id
       AND team.status='active' AND v_user IN (team.player_one_id,team.player_two_id)) THEN
    RAISE EXCEPTION 'You have a confirmed League partner. Register your team instead';
  END IF;
  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  IF v_profile.gender IS NOT NULL AND v_profile.gender<>(CASE WHEN v_category='men' THEN 'male' ELSE 'female' END) THEN
    RAISE EXCEPTION 'Your profile gender does not match this League category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.event_id=p_event_id
       AND p.user_id=v_user AND p.category=v_category AND p.status='registered') THEN
    RAISE EXCEPTION 'You are already registered for this League event';
  END IF;
  IF (SELECT count(*) FROM public.tournament_participants p
      WHERE p.event_id=p_event_id AND p.status='registered')+1>v_event.capacity THEN
    RAISE EXCEPTION 'League event registration is full';
  END IF;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  INSERT INTO public.tournament_participants(
    event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status
  ) VALUES (
    p_event_id,v_user,v_category,coalesce(nullif(v_profile.full_name,''),v_profile.email),
    v_profile.email,v_profile.phone,v_profile.gender,v_amount,
    CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END
  ) RETURNING id,amount_cents,payment_status
    INTO v_participant_id,v_amount,v_payment_status;
  RETURN jsonb_build_object('participantId',v_participant_id,'amountCents',v_amount,
    'paymentStatus',v_payment_status,'singleRegistration',true);
END; $$;

REVOKE ALL ON FUNCTION public.register_league_single_event_entry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_single_event_entry(uuid) TO authenticated;


-- Require the League event to have started before any score can be entered.

CREATE OR REPLACE FUNCTION public.submit_league_match_score(
  p_match_id uuid,
  p_score_one integer,
  p_score_two integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_league_id uuid;
  v_pair_one uuid;
  v_pair_two uuid;
  v_organizer_id uuid;
  v_created_by uuid;
  v_is_manager boolean := false;
BEGIN
  IF auth.uid() IS NULL OR p_score_one IS NULL OR p_score_two IS NULL
    OR p_score_one < 0 OR p_score_two < 0 OR p_score_one = p_score_two THEN
    RAISE EXCEPTION 'Enter two different non-negative scores';
  END IF;

  SELECT e.id,e.starts_at,e.social_doubles_ladder_id,m.status,m.pair_one_id,m.pair_two_id,
         e.organizer_id,e.created_by
    INTO v_event_id,v_starts_at,v_league_id,v_status,v_pair_one,v_pair_two,
         v_organizer_id,v_created_by
  FROM public.tournament_matches m
  JOIN public.events e ON e.id=m.event_id
  JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE m.id=p_match_id AND e.event_type='tournament' AND e.tournament_format='doubles'
    AND m.phase='round_robin' AND m.pair_one_id IS NOT NULL AND m.pair_two_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'League match not found'; END IF;
  IF v_status='cancelled' THEN RAISE EXCEPTION 'This match was cancelled'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.application_status='approved'
      AND (p.role='admin' OR (p.role='organizer' AND COALESCE(v_organizer_id,v_created_by)=auth.uid()))
  ) INTO v_is_manager;

  IF now() < v_starts_at THEN
    RAISE EXCEPTION 'Scores cannot be entered before the event start time';
  END IF;
  IF NOT v_is_manager AND now() - v_starts_at > interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event start';
  END IF;

  IF NOT v_is_manager AND NOT EXISTS (
    SELECT 1
    FROM public.tournament_pairs pair
    JOIN public.league_teams team ON team.id=pair.league_team_id
      AND team.league_id=v_league_id AND team.status='active'
    JOIN public.tournament_participants player ON player.id IN (pair.player_one_id,pair.player_two_id)
    WHERE pair.id IN (v_pair_one,v_pair_two) AND pair.event_id=v_event_id AND pair.status='active'
      AND player.user_id=auth.uid()
      AND player.user_id IN (team.player_one_id,team.player_two_id)
  ) THEN
    RAISE EXCEPTION 'Only players in these fixed League teams or approved event managers can submit the match score';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets=jsonb_build_array(jsonb_build_object('one',p_score_one,'two',p_score_two)),
      winner_side=CASE WHEN p_score_one > p_score_two THEN 1 ELSE 2 END,
      status='completed',
      team_points_one=CASE WHEN p_score_one > p_score_two THEN 3 ELSE 0 END,
      team_points_two=CASE WHEN p_score_two > p_score_one THEN 3 ELSE 0 END,
      entered_by=auth.uid(),
      updated_at=now()
  WHERE id=p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_league_match_score(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_league_match_score(uuid,integer,integer) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='league_event_court_assignments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.league_event_court_assignments';
  END IF;
END $$;


-- Shared fixed-window rate limiter for server routes; reachable by the service role only.

CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz;
  v_hits integer;
BEGIN
  IF p_key IS NULL OR length(p_key) > 200 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit arguments';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limit_hits AS r (key, window_start, hits)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_hits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN v_hits <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;


-- Lets a dispatch run claim queue rows before sending so concurrent runs cannot mail the same row twice.

ALTER TABLE public.event_notification_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;


-- Verified event-only accounts and explicit confirmation of every tournament pair.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'member';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_kind_check
    CHECK (account_kind IN ('member','event_guest'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.tournament_participants ADD CONSTRAINT tournament_participants_confirmation_status_check
    CHECK (confirmation_status IN ('pending','confirmed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.tournament_participants
  SET confirmed_at=coalesce(confirmed_at,created_at),confirmation_status='confirmed'
  WHERE confirmation_status='confirmed';

-- A first-time magic-link user may create an event-only profile without entering
-- membership application fields. The account_kind is still restricted to event_guest.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_guest boolean := new.raw_user_meta_data->>'account_kind'='event_guest';
BEGIN
  IF NOT v_event_guest THEN
    IF coalesce(new.raw_user_meta_data->>'tennis_skill_level','') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN
      RAISE EXCEPTION 'A valid tennis skill rating is required to register.';
    END IF;
    IF coalesce(trim(new.raw_user_meta_data->>'phone'),'')='' THEN
      RAISE EXCEPTION 'A phone number is required to register.';
    END IF;
  END IF;
  INSERT INTO public.profiles(id,email,full_name,phone,tennis_skill_level,account_kind)
  VALUES (
    new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),
    CASE WHEN v_event_guest THEN '' ELSE trim(new.raw_user_meta_data->>'phone') END,
    CASE WHEN v_event_guest THEN NULL ELSE new.raw_user_meta_data->>'tennis_skill_level' END,
    CASE WHEN v_event_guest THEN 'event_guest' ELSE 'member' END
  );
  RETURN new;
END;
$$;

-- Only verified authenticated event guests can create public entries. Partner details
-- are saved as pending until the invited player signs in and confirms them.
CREATE OR REPLACE FUNCTION public.register_event_guest_tournament_entry(
  p_event_id uuid,p_category text,p_display_name text,p_phone text,p_gender text,
  p_tennis_skill_level numeric,p_partner_name text DEFAULT NULL,p_partner_email text DEFAULT NULL,
  p_partner_phone text DEFAULT NULL,p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid:=auth.uid(); v_profile public.profiles%rowtype; v_partner public.profiles%rowtype;
  v_auth_email text; v_auth_confirmed timestamptz; v_event public.events%rowtype; v_config jsonb; v_league_gender text;
  v_partner_user uuid; v_own_id uuid; v_partner_id uuid; v_pair_id uuid; v_amount integer;
  v_partner_member boolean:=false; v_has_partner boolean; v_partner_gender_effective text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Verify your email before registering'; END IF;
  SELECT email,email_confirmed_at INTO v_auth_email,v_auth_confirmed FROM auth.users WHERE id=v_user;
  IF v_auth_email IS NULL OR v_auth_confirmed IS NULL THEN
    RAISE EXCEPTION 'Verify your email before registering';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND account_kind='event_guest';
  IF NOT FOUND OR lower(v_profile.email)<>lower(v_auth_email) THEN RAISE EXCEPTION 'Event-only registration session required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament' AND status='published';
  IF NOT FOUND OR NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'This event does not accept event-only registration'; END IF;
  IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
    RAISE EXCEPTION 'Event registration is closed';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160 OR length(btrim(coalesce(p_phone,'')))>40 THEN
    RAISE EXCEPTION 'Enter a valid name and phone number';
  END IF;
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7 AND mod(p_tennis_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  v_config:=coalesce(v_event.tournament_config,'{}'::jsonb);
  IF v_event.social_doubles_ladder_id IS NOT NULL THEN
    SELECT gender INTO v_league_gender FROM public.social_doubles_ladders
      WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
    IF v_league_gender IS NOT NULL THEN p_category:=CASE WHEN v_league_gender='male' THEN 'men' ELSE 'women' END; END IF;
  END IF;
  IF v_event.tournament_format='team' THEN
    IF p_category<>'team' THEN RAISE EXCEPTION 'Invalid team tournament category'; END IF;
  ELSIF p_category NOT IN ('mixed','men','women') OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN
    RAISE EXCEPTION 'This tournament category is unavailable';
  END IF;
  IF p_category='men' AND p_gender IS NOT NULL AND p_gender<>'male' THEN RAISE EXCEPTION 'This gender is not eligible for men''s doubles'; END IF;
  IF p_category='women' AND p_gender IS NOT NULL AND p_gender<>'female' THEN RAISE EXCEPTION 'This gender is not eligible for women''s doubles'; END IF;
  v_has_partner:=nullif(btrim(p_partner_name),'') IS NOT NULL OR nullif(btrim(p_partner_email),'') IS NOT NULL;
  IF v_has_partner AND (nullif(btrim(p_partner_name),'') IS NULL OR nullif(btrim(p_partner_email),'') IS NULL) THEN
    RAISE EXCEPTION 'Enter both your partner''s name and email';
  END IF;
  IF v_has_partner AND (v_event.tournament_format<>'doubles' OR coalesce(v_config->>'registration_mode','both')='single') THEN
    RAISE EXCEPTION 'This event does not accept partner registration';
  END IF;
  IF NOT v_has_partner AND v_event.tournament_format='doubles' AND coalesce(v_config->>'registration_mode','both')='doubles' THEN
    RAISE EXCEPTION 'Register with a partner for this event';
  END IF;
  IF p_partner_skill_level IS NOT NULL AND NOT (p_partner_skill_level BETWEEN 2.5 AND 7 AND mod(p_partner_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Partner skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender'; END IF;
  IF p_category='men' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'male' THEN RAISE EXCEPTION 'Partner gender is not eligible for men''s doubles'; END IF;
  IF p_category='women' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'female' THEN RAISE EXCEPTION 'Partner gender is not eligible for women''s doubles'; END IF;
  IF v_has_partner AND p_category='mixed' AND p_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND p_gender=p_partner_gender THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;

  SELECT * INTO v_partner FROM public.profiles WHERE lower(email)=lower(btrim(p_partner_email)) LIMIT 1;
  IF FOUND THEN
    IF v_partner.id=v_user THEN RAISE EXCEPTION 'You cannot register as your own partner'; END IF;
    IF v_partner.account_kind='member' THEN
      v_partner_user:=v_partner.id; v_partner_member:=true;
    ELSIF v_partner.account_kind='event_guest' THEN
      v_partner_user:=v_partner.id;
    ELSE
      RAISE EXCEPTION 'Partner email belongs to an account that must sign in through member login';
    END IF;
  END IF;
  v_partner_gender_effective:=CASE WHEN v_partner_member THEN v_partner.gender ELSE coalesce(v_partner.gender,p_partner_gender) END;
  IF v_has_partner AND p_category='men' AND v_partner_gender_effective IS NOT NULL AND v_partner_gender_effective<>'male' THEN
    RAISE EXCEPTION 'Partner gender is not eligible for men''s doubles';
  END IF;
  IF v_has_partner AND p_category='women' AND v_partner_gender_effective IS NOT NULL AND v_partner_gender_effective<>'female' THEN
    RAISE EXCEPTION 'Partner gender is not eligible for women''s doubles';
  END IF;
  IF v_has_partner AND p_category='mixed' AND p_gender IN ('male','female')
    AND v_partner_gender_effective IN ('male','female') AND p_gender=v_partner_gender_effective THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status IN ('registered','provisional')) THEN
    RAISE EXCEPTION 'You are already registered in this category';
  END IF;
  v_amount:=greatest(coalesce(v_event.price_cents,0),0);
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,amount_cents,payment_status,confirmation_status,confirmed_at)
  VALUES(p_event_id,v_user,p_category,btrim(p_display_name),lower(v_auth_email),nullif(btrim(p_phone),''),p_gender,p_tennis_skill_level,v_amount,
    CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,'confirmed',now()) RETURNING id INTO v_own_id;
  IF v_has_partner THEN
    INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,amount_cents,payment_status,status,confirmation_status,confirmed_at)
    VALUES(p_event_id,v_partner_user,p_category,
      CASE WHEN v_partner_member THEN coalesce(nullif(v_partner.full_name,''),v_partner.email)
        WHEN v_partner_user IS NOT NULL THEN coalesce(nullif(v_partner.full_name,''),nullif(btrim(p_partner_name),''),v_partner.email)
        ELSE btrim(p_partner_name) END,
      lower(btrim(p_partner_email)),
      CASE WHEN v_partner_member THEN nullif(v_partner.phone,'')
        WHEN v_partner_user IS NOT NULL THEN coalesce(nullif(v_partner.phone,''),nullif(btrim(p_partner_phone),''))
        ELSE nullif(btrim(p_partner_phone),'') END,
      CASE WHEN v_partner_member THEN v_partner.gender ELSE coalesce(v_partner.gender,p_partner_gender) END,
      CASE WHEN v_partner_member THEN NULL ELSE coalesce(v_partner.tennis_skill_level::numeric,p_partner_skill_level) END,
      v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,'provisional','pending',NULL)
    RETURNING id INTO v_partner_id;
    INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(p_event_id,p_category,v_own_id,v_partner_id) RETURNING id INTO v_pair_id;
  END IF;
  RETURN jsonb_build_object('participantId',v_own_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,
    'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,
    'partnerIsMember',v_partner_member,'partnerEmail',CASE WHEN v_has_partner THEN lower(btrim(p_partner_email)) ELSE NULL END);
END; $$;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) TO authenticated;

-- Every partner invited by a member must confirm before the pair can be paid.
ALTER FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  RENAME TO register_tournament_entry_confirmed_base;
REVOKE ALL ON FUNCTION public.register_tournament_entry_confirmed_base(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid,p_category text,p_display_name text,p_email text,p_phone text,p_gender text,
 p_partner_participant_id uuid,p_partner_name text,p_partner_email text,p_partner_phone text,
 p_partner_gender text,p_partner_user_id uuid,p_tennis_skill_level numeric,p_partner_tennis_skill_level numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_partner_id uuid; v_partner public.profiles%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before registering'; END IF;
  v_result:=public.register_tournament_entry_confirmed_base(p_event_id,p_category,p_display_name,p_email,p_phone,p_gender,
    p_partner_participant_id,p_partner_name,p_partner_email,p_partner_phone,p_partner_gender,p_partner_user_id,
    p_tennis_skill_level,p_partner_tennis_skill_level);
  v_partner_id:=nullif(v_result->>'partnerParticipantId','')::uuid;
  IF v_partner_id IS NOT NULL THEN
    UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL
      WHERE id=v_partner_id;
    SELECT * INTO v_partner FROM public.profiles WHERE id=p_partner_user_id;
    v_result:=v_result||jsonb_build_object('partnerIsMember',p_partner_user_id IS NOT NULL,
      'partnerEmail',coalesce(v_partner.email,p_partner_email));
  END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_tournament_partner(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid:=auth.uid(); v_email text; v_confirmed_at timestamptz;
  v_event public.events%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to confirm this invitation'; END IF;
  SELECT email_confirmed_at,email INTO v_confirmed_at,v_email FROM auth.users WHERE id=v_user;
  IF v_confirmed_at IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'Verify the invited email first'; END IF;
  SELECT e.* INTO v_event FROM public.events e JOIN public.tournament_participants p ON p.event_id=e.id
    WHERE p.id=p_participant_id;
  IF NOT FOUND OR v_event.status<>'published' OR now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The event registration cutoff has passed';
  END IF;
  UPDATE public.tournament_participants p SET user_id=v_user,confirmation_status='confirmed',confirmed_at=now(),status='registered',updated_at=now()
  WHERE p.id=p_participant_id AND p.confirmation_status='pending' AND lower(p.email)=lower(v_email)
    AND p.status IN ('registered','provisional')
    AND EXISTS (SELECT 1 FROM public.tournament_pairs pair WHERE pair.event_id=p.event_id AND pair.status='active'
      AND p.id IN (pair.player_one_id,pair.player_two_id))
    AND NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair JOIN public.tournament_participants other
      ON other.id IN (pair.player_one_id,pair.player_two_id) AND other.id<>p.id
      WHERE pair.event_id=p.event_id AND pair.status='active' AND p.id IN (pair.player_one_id,pair.player_two_id) AND other.user_id=v_user);
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation does not match your verified email or is no longer available'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_tournament_partner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_tournament_partner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_unconfirmed_tournament_partner(
  p_participant_id uuid,p_partner_user_id uuid DEFAULT NULL,p_partner_name text DEFAULT NULL,
  p_partner_email text DEFAULT NULL,p_partner_phone text DEFAULT NULL,p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid:=auth.uid(); v_own public.tournament_participants%rowtype;
  v_partner public.tournament_participants%rowtype; v_event public.events%rowtype;
  v_existing public.profiles%rowtype; v_pair public.tournament_pairs%rowtype;
  v_user_id uuid; v_member boolean:=false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to change your partner'; END IF;
  SELECT * INTO v_own FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=v_user AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_own.event_id
    AND status='active' AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active partner is assigned'; END IF;
  SELECT * INTO v_partner FROM public.tournament_participants
    WHERE id=CASE WHEN v_pair.player_one_id=p_participant_id THEN v_pair.player_two_id ELSE v_pair.player_one_id END FOR UPDATE;
  IF v_partner.confirmation_status<>'pending' THEN RAISE EXCEPTION 'A confirmed partner cannot be changed'; END IF;
  IF v_pair.league_team_id IS NOT NULL THEN RAISE EXCEPTION 'An established League team partner cannot be changed'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_own.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The registration cutoff has passed'; END IF;

  IF p_partner_user_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.profiles WHERE id=p_partner_user_id
      AND application_status='approved' AND account_kind='member';
    IF NOT FOUND OR p_partner_user_id=v_user THEN RAISE EXCEPTION 'Select an eligible member partner'; END IF;
    v_user_id:=v_existing.id; v_member:=true;
  ELSE
    IF nullif(btrim(p_partner_name),'') IS NULL OR nullif(btrim(p_partner_email),'') IS NULL
      OR length(btrim(p_partner_name))>160 OR length(btrim(p_partner_email))>254 THEN
      RAISE EXCEPTION 'Enter a valid partner name and email';
    END IF;
    SELECT * INTO v_existing FROM public.profiles WHERE lower(email)=lower(btrim(p_partner_email)) LIMIT 1;
    IF FOUND THEN
      IF v_existing.id=v_user THEN RAISE EXCEPTION 'You cannot register as your own partner'; END IF;
      IF v_existing.account_kind='member' THEN
        v_user_id:=v_existing.id; v_member:=true;
      ELSIF v_existing.account_kind='event_guest' THEN v_user_id:=v_existing.id;
      ELSE RAISE EXCEPTION 'Partner email belongs to an account that must sign in through member login'; END IF;
    END IF;
  END IF;
  IF p_partner_skill_level IS NOT NULL AND NOT (p_partner_skill_level BETWEEN 2.5 AND 7 AND mod(p_partner_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Invalid partner skill rating';
  END IF;
  IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender'; END IF;
  IF v_own.category='mixed' AND v_own.gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_own.gender=p_partner_gender THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner.id AND confirmation_status='pending';
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,
    amount_cents,payment_status,status,confirmation_status,confirmed_at)
  VALUES(v_own.event_id,v_user_id,v_own.category,
    CASE WHEN v_member THEN coalesce(nullif(v_existing.full_name,''),v_existing.email)
      WHEN v_user_id IS NOT NULL THEN coalesce(nullif(v_existing.full_name,''),nullif(btrim(p_partner_name),''),v_existing.email)
      ELSE btrim(p_partner_name) END,
    CASE WHEN v_member THEN lower(v_existing.email) ELSE lower(btrim(p_partner_email)) END,
    CASE WHEN v_member THEN nullif(v_existing.phone,'')
      WHEN v_user_id IS NOT NULL THEN coalesce(nullif(v_existing.phone,''),nullif(btrim(p_partner_phone),''))
      ELSE nullif(btrim(p_partner_phone),'') END,
    CASE WHEN v_member THEN v_existing.gender ELSE coalesce(v_existing.gender,p_partner_gender) END,
    CASE WHEN v_member THEN NULL ELSE coalesce(v_existing.tennis_skill_level::numeric,p_partner_skill_level) END,
    v_own.amount_cents,v_own.payment_status,'provisional','pending',NULL) RETURNING * INTO v_partner;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(v_own.event_id,v_own.category,v_own.id,v_partner.id);
  RETURN jsonb_build_object('partnerParticipantId',v_partner.id,'partnerEmail',v_partner.email,'partnerIsMember',v_member);
END; $$;
REVOKE ALL ON FUNCTION public.update_unconfirmed_tournament_partner(uuid,uuid,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_unconfirmed_tournament_partner(uuid,uuid,text,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_unconfirmed_tournament_partner(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid:=auth.uid(); v_own public.tournament_participants%rowtype; v_pair public.tournament_pairs%rowtype;
  v_event public.events%rowtype; v_partner_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to change your registration'; END IF;
  SELECT * INTO v_own FROM public.tournament_participants WHERE id=p_participant_id AND user_id=v_user AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_own.event_id;
  IF v_event.tournament_format<>'doubles' OR coalesce(v_event.tournament_config->>'registration_mode','both')='doubles' THEN
    RAISE EXCEPTION 'This event does not allow single registration';
  END IF;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The registration cutoff has passed'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_own.event_id AND status='active'
    AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active partner is assigned'; END IF;
  IF v_pair.league_team_id IS NOT NULL THEN RAISE EXCEPTION 'An established League team cannot switch to a single entry'; END IF;
  v_partner_id:=CASE WHEN v_pair.player_one_id=p_participant_id THEN v_pair.player_two_id ELSE v_pair.player_one_id END;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=v_partner_id AND confirmation_status='pending') THEN
    RAISE EXCEPTION 'A confirmed partner cannot be removed';
  END IF;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner_id;
END; $$;
REVOKE ALL ON FUNCTION public.remove_unconfirmed_tournament_partner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_unconfirmed_tournament_partner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event_guest_registration_details(
  p_participant_id uuid,p_display_name text,p_phone text,p_gender text,p_tennis_skill_level numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_event public.events%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND account_kind='event_guest'
  ) THEN RAISE EXCEPTION 'Event-only registration session required'; END IF;
  SELECT * INTO v_entry FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The registration cutoff has passed';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160
    OR length(btrim(coalesce(p_phone,'')))>40 THEN RAISE EXCEPTION 'Enter a valid name and phone number'; END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  IF (v_entry.category='men' AND p_gender IS NOT NULL AND p_gender<>'male')
    OR (v_entry.category='women' AND p_gender IS NOT NULL AND p_gender<>'female') THEN
    RAISE EXCEPTION 'This gender is not eligible for the registered category';
  END IF;
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7 AND mod(p_tennis_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  UPDATE public.tournament_participants SET display_name=btrim(p_display_name),phone=nullif(btrim(p_phone),''),
    gender=p_gender,tennis_skill_level=p_tennis_skill_level,updated_at=now() WHERE id=v_entry.id;
END; $$;
REVOKE ALL ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_tournament_my_entries(p_event_id uuid)
RETURNS TABLE(id uuid,team_id uuid,category text,display_name text,email text,phone text,gender text,tennis_skill_level numeric,
  payment_status text,amount_cents integer,confirmation_status text,partner_id uuid,partner_name text,partner_email text,
  partner_phone text,partner_gender text,partner_skill_level numeric,partner_confirmation_status text,partner_is_league_team boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT own.id,own.team_id,own.category,own.display_name,own.email,own.phone,coalesce(own.gender_override,own.gender),own.tennis_skill_level,
    own.payment_status,own.amount_cents,own.confirmation_status,partner.id,partner.display_name,partner.email,partner.phone,
    coalesce(partner.gender_override,partner.gender),partner.tennis_skill_level,partner.confirmation_status,(pair.league_team_id IS NOT NULL)
  FROM public.tournament_participants own
  LEFT JOIN public.tournament_pairs pair ON pair.event_id=own.event_id AND pair.status='active'
    AND own.id IN (pair.player_one_id,pair.player_two_id)
  LEFT JOIN public.tournament_participants partner ON partner.id=CASE WHEN pair.player_one_id=own.id THEN pair.player_two_id ELSE pair.player_one_id END
  WHERE own.event_id=p_event_id AND own.user_id=auth.uid() AND own.status IN ('registered','provisional')
  ORDER BY own.created_at,own.category;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_my_entries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_my_entries(uuid) TO authenticated;

-- Manager-assigned pairs require explicit confirmation from both participants.
CREATE OR REPLACE FUNCTION public.admin_create_tournament_pair(p_event_id uuid,p_category text,p_one uuid,p_two uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair uuid;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.created_by=auth.uid() OR e.organizer_id=auth.uid())) THEN
    RAISE EXCEPTION 'Event manager access required';
  END IF;
  IF p_one=p_two OR NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=p_one AND event_id=p_event_id AND category=p_category AND status='registered')
    OR NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=p_two AND event_id=p_event_id AND category=p_category AND status='registered') THEN
    RAISE EXCEPTION 'Select two registered participants in the same category';
  END IF;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(p_event_id,p_category,p_one,p_two) RETURNING id INTO v_pair;
  UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL,updated_at=now()
    WHERE id IN (p_one,p_two);
  RETURN v_pair;
END; $$;
REVOKE ALL ON FUNCTION public.admin_create_tournament_pair(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_tournament_pair(uuid,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_require_pair_confirmation(p_pair_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event uuid; v_one uuid; v_two uuid;
BEGIN
  SELECT event_id,player_one_id,player_two_id INTO v_event,v_one,v_two
    FROM public.tournament_pairs WHERE id=p_pair_id AND status='active' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=v_event AND
      (public.is_admin() OR e.created_by=auth.uid() OR e.organizer_id=auth.uid())
  ) THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL,updated_at=now()
    WHERE id IN (v_one,v_two) AND event_id=v_event AND status='registered';
  IF NOT FOUND THEN RAISE EXCEPTION 'Both pair members must have active registrations'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_require_pair_confirmation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_require_pair_confirmation(uuid) TO authenticated;

-- Publicly enabled League events may also contain event-only players. Existing
-- rostered League members remain locked to their confirmed League teammates.
CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_league uuid; v_gender text; v_allow_guest boolean; v_one uuid; v_two uuid;
  v_one_status text; v_two_status text; v_one_confirm text; v_two_confirm text; v_one_email text; v_two_email text;
  v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender,e.allow_non_member_registration
    INTO v_league,v_gender,v_allow_guest
  FROM public.events e JOIN public.social_doubles_ladders l
    ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id,p1.status,p2.status,p1.confirmation_status,p2.confirmation_status,p1.email,p2.email
    INTO v_one,v_two,v_one_status,v_two_status,v_one_confirm,v_two_confirm,v_one_email,v_two_email
    FROM public.tournament_participants p1,public.tournament_participants p2
    WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF (v_one IS NULL AND NOT (v_allow_guest AND v_one_status='provisional' AND v_one_confirm='pending' AND v_one_email IS NOT NULL))
    OR (v_two IS NULL AND NOT (v_allow_guest AND v_two_status='provisional' AND v_two_confirm='pending' AND v_two_email IS NOT NULL)) THEN
    RAISE EXCEPTION 'League teams require two verified players or an invited event-only partner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two)
      AND NOT (p.application_status='approved' AND p.account_kind='member')
      AND NOT (v_allow_guest AND p.account_kind IN ('event_guest','member'))
  ) THEN RAISE EXCEPTION 'League participants must be approved members or verified event-only registrants'; END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two)
      OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,(p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));
CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id,p.event_id,p.category,p.player_one_id,p.player_two_id,p.group_number,p.seed,p.status,
  a.display_name AS player_one_name,b.display_name AS player_two_name,
  coalesce(a.tennis_skill_level::text,profile_a.tennis_skill_level) AS player_one_skill_level,
  coalesce(b.tennis_skill_level::text,profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered' AND a.confirmation_status='confirmed'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered' AND b.confirmation_status='confirmed'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));

CREATE OR REPLACE FUNCTION public.event_tournament_pair_payment_status(p_event_id uuid)
RETURNS TABLE(pair_id uuid,player_one_id uuid,player_two_id uuid,player_one_payment_status text,player_two_payment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  RETURN QUERY SELECT pair.id,pair.player_one_id,pair.player_two_id,one.payment_status,two.payment_status
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants one ON one.id=pair.player_one_id
  JOIN public.tournament_participants two ON two.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.status='active'
    AND one.status='registered' AND two.status='registered'
    AND one.confirmation_status='confirmed' AND two.confirmation_status='confirmed'
    AND (one.user_id=auth.uid() OR two.user_id=auth.uid());
END; $$;
REVOKE ALL ON FUNCTION public.event_tournament_pair_payment_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_pair_payment_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_unconfirmed_tournament_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND NEW.confirmation_status<>'confirmed' THEN
    RAISE EXCEPTION 'Both tournament partners must confirm before payment';
  END IF;
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants partner
        ON partner.id=CASE WHEN pair.player_one_id=NEW.id THEN pair.player_two_id ELSE pair.player_one_id END
      WHERE pair.event_id=NEW.event_id AND pair.status='active'
        AND NEW.id IN (pair.player_one_id,pair.player_two_id)
        AND (partner.status<>'registered' OR partner.confirmation_status<>'confirmed')
    ) THEN
    RAISE EXCEPTION 'Both tournament partners must confirm before payment';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS a_prevent_unconfirmed_tournament_payment ON public.tournament_participants;
CREATE TRIGGER a_prevent_unconfirmed_tournament_payment
BEFORE UPDATE OF payment_status ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.prevent_unconfirmed_tournament_payment();

CREATE OR REPLACE FUNCTION public.withdraw_tournament_entry(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_partner public.tournament_participants%rowtype;
  v_event public.events%rowtype; v_pair public.tournament_pairs%rowtype; v_partner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to withdraw this entry'; END IF;
  SELECT * INTO v_entry FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered entry not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The withdrawal cutoff has passed'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_entry.event_id AND status='active'
    AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF FOUND THEN
    v_partner_id:=CASE WHEN v_pair.player_one_id=v_entry.id THEN v_pair.player_two_id ELSE v_pair.player_one_id END;
    SELECT * INTO v_partner FROM public.tournament_participants WHERE id=v_partner_id FOR UPDATE;
    IF v_entry.confirmation_status='confirmed' AND v_partner.confirmation_status='confirmed'
      AND (v_entry.payment_status='paid' OR v_partner.payment_status='paid'
        OR (v_entry.payment_status='not_required' AND v_partner.payment_status='not_required')) THEN
      UPDATE public.tournament_participants SET status='withdrawn',updated_at=now()
        WHERE id IN (v_entry.id,v_partner.id) AND status IN ('registered','provisional');
      UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
      RETURN;
    END IF;
    UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
    IF v_partner.confirmation_status='pending' THEN
      UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner.id;
    END IF;
  END IF;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_entry.id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_tournament_entry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_tournament_entry(uuid) TO authenticated;


-- Only approved club members appear in member-facing directories and standings.
-- Verified event-only profiles remain visible on their event registrations.

CREATE OR REPLACE FUNCTION public.event_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, avatar_url text, email text, phone text, tennis_skill_level text, suspended boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_day date;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO v_event_day
 FROM public.events e WHERE e.id=p_event_id;
 IF v_event_day IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
 RETURN QUERY
 SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text,
   EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p.id AND s.cancelled_at IS NULL
     AND v_event_day BETWEEN s.starts_on AND s.ends_on)
 FROM public.profiles p
 WHERE p.application_status='approved' AND p.account_kind='member'
 ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_member_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_tournament_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, email text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() OR NOT EXISTS (
   SELECT 1 FROM public.events e WHERE e.id=p_event_id
     AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
 ) THEN RAISE EXCEPTION 'Tournament manager access required'; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.email,p.gender
 FROM public.profiles p
 WHERE p.application_status='approved' AND p.account_kind='member'
 ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_tournament_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_member_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.league_event_pair_eligibility(p_event_id uuid)
RETURNS TABLE(user_id uuid,eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND l.competition_type='league'
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  RETURN QUERY
  SELECT profile.id,public.has_active_paid_membership(profile.id)
  FROM public.profiles profile
  WHERE profile.application_status='approved' AND profile.account_kind='member';
END; $$;
REVOKE ALL ON FUNCTION public.league_event_pair_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.league_event_pair_eligibility(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_tournament_partner_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.application_status='approved' AND p.account_kind='member'
  ) THEN RAISE EXCEPTION 'An approved member account is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
    AND e.event_type='tournament' AND e.status='published') THEN
    RAISE EXCEPTION 'Tournament is unavailable';
  END IF;
  RETURN QUERY SELECT p.id,coalesce(nullif(p.full_name,''),p.email),p.gender
  FROM public.profiles p
  WHERE p.application_status='approved' AND p.account_kind='member' AND p.id<>auth.uid()
  ORDER BY coalesce(nullif(p.full_name,''),p.email);
END; $$;
REVOKE ALL ON FUNCTION public.event_tournament_partner_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_partner_directory(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
    OR profile.account_kind='event_guest')
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id,p.event_id,p.category,p.player_one_id,p.player_two_id,p.group_number,p.seed,p.status,
  a.display_name AS player_one_name,b.display_name AS player_two_name,
  coalesce(a.tennis_skill_level::text,profile_a.tennis_skill_level) AS player_one_skill_level,
  coalesce(b.tennis_skill_level::text,profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered'
  AND a.confirmation_status='confirmed'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered'
  AND b.confirmation_status='confirmed'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published'
  AND (a.user_id IS NULL OR (profile_a.application_status='approved' AND profile_a.account_kind='member')
    OR profile_a.account_kind='event_guest')
  AND (b.user_id IS NULL OR (profile_b.application_status='approved' AND profile_b.account_kind='member')
    OR profile_b.account_kind='event_guest')
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id,t.event_id,t.name,t.logo_url,t.color,t.group_number,t.captain_user_id,
  CASE WHEN captain.application_status='approved' AND captain.account_kind='member'
    THEN captain.full_name ELSE NULL END AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles captain ON captain.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
    AND own.user_id=auth.uid() AND own.status='registered'
)));

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  coalesce(side_one.players,pair_one.player_one_name || ' + ' || pair_one.player_two_name) AS player_one_name,
  NULL::text AS player_two_name,
  coalesce(side_two.players,pair_two.player_one_name || ' + ' || pair_two.player_two_name) AS opponent_one_name,
  NULL::text AS opponent_two_name
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams team_one ON team_one.id=m.team_one_id
LEFT JOIN public.tournament_teams team_two ON team_two.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs pair_one ON pair_one.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs pair_two ON pair_two.id=m.pair_two_id
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=1
    AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
      OR profile.account_kind='event_guest')
) side_one ON true
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=2
    AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
      OR profile.account_kind='event_guest')
) side_two ON true
WHERE (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
    AND own.user_id=auth.uid() AND own.status='registered'
)));


-- Admin navigation badges refresh immediately when member applications are created or reviewed.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- Capture the optional gender and birthday fields during member account creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event_guest boolean := new.raw_user_meta_data->>'account_kind'='event_guest';
  v_gender text := NULLIF(new.raw_user_meta_data->>'gender','');
  v_date_text text := NULLIF(new.raw_user_meta_data->>'date_of_birth','');
  v_date_of_birth date;
BEGIN
  IF v_date_text IS NOT NULL THEN
    IF v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Date of birth must use YYYY-MM-DD format.';
    END IF;
    v_date_of_birth := v_date_text::date;
    IF to_char(v_date_of_birth,'YYYY-MM-DD')<>v_date_text OR v_date_of_birth>current_date THEN
      RAISE EXCEPTION 'Enter a valid date of birth.';
    END IF;
  END IF;
  IF NOT v_event_guest THEN
    IF coalesce(new.raw_user_meta_data->>'tennis_skill_level','') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN
      RAISE EXCEPTION 'A valid tennis skill rating is required to register.';
    END IF;
    IF coalesce(trim(new.raw_user_meta_data->>'phone'),'')='' THEN
      RAISE EXCEPTION 'A phone number is required to register.';
    END IF;
  END IF;
  INSERT INTO public.profiles(id,email,full_name,phone,tennis_skill_level,account_kind,gender,date_of_birth)
  VALUES (
    new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),
    CASE WHEN v_event_guest THEN '' ELSE trim(new.raw_user_meta_data->>'phone') END,
    CASE WHEN v_event_guest THEN NULL ELSE new.raw_user_meta_data->>'tennis_skill_level' END,
    CASE WHEN v_event_guest THEN 'event_guest' ELSE 'member' END,
    CASE WHEN v_event_guest THEN NULL ELSE v_gender END,
    CASE WHEN v_event_guest THEN NULL ELSE v_date_of_birth END
  );
  RETURN new;
END;
$$;

-- Let members refresh their unpaid-membership navigation badge after payment confirmation.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payments','memberships','membership_family_members','membership_families'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
    END IF;
  END LOOP;
END $$;

-- A fully refunded membership payment must no longer mark its membership as paid.
CREATE OR REPLACE FUNCTION public.reset_membership_after_full_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_family_id uuid;
  v_membership_id uuid;
BEGIN
  IF NEW.purpose <> 'membership'
     OR NEW.status <> 'refunded'
     OR NEW.refunded_amount_minor < NEW.amount_minor THEN
    RETURN NEW;
  END IF;

  IF NEW.business_record_id LIKE 'family:%'
     AND substring(NEW.business_record_id FROM 8) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_family_id := substring(NEW.business_record_id FROM 8)::uuid;
    UPDATE public.membership_families
    SET paid_at = NULL, paid_by = NULL, payment_id = NULL
    WHERE id = v_family_id AND payment_id = NEW.id;
  ELSIF NEW.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_membership_id := NEW.business_record_id::uuid;
    UPDATE public.memberships
    SET payment_status = 'unpaid', updated_at = now()
    WHERE id = v_membership_id AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reset_membership_after_full_refund ON public.payments;
CREATE TRIGGER reset_membership_after_full_refund
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.reset_membership_after_full_refund();

-- Repair memberships affected by full refunds recorded before this trigger existed.
UPDATE public.memberships m
SET payment_status = 'unpaid', updated_at = now()
FROM public.payments p
WHERE p.purpose = 'membership'
  AND p.status = 'refunded'
  AND p.refunded_amount_minor >= p.amount_minor
  AND p.business_record_id = m.id::text
  AND p.user_id = m.user_id
  AND m.payment_status IS DISTINCT FROM 'unpaid';

UPDATE public.membership_families f
SET paid_at = NULL, paid_by = NULL, payment_id = NULL
FROM public.payments p
WHERE p.purpose = 'membership'
  AND p.status = 'refunded'
  AND p.refunded_amount_minor >= p.amount_minor
  AND p.business_record_id = 'family:' || f.id::text
  AND p.id = f.payment_id;

-- Queue one new-event email per recipient for a recurring series.
CREATE OR REPLACE FUNCTION public.queue_new_event_email_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Recurring sessions are separate event rows. Only the earliest session
    -- represents the series in the notification queue.
    IF NEW.series_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.events earlier
      WHERE earlier.series_id = NEW.series_id
        AND (earlier.starts_at, earlier.id) < (NEW.starts_at, NEW.id)
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.event_notification_queue(event_id, user_id, notification_type)
    SELECT NEW.id, p.id, 'new_event_created'
    FROM public.profiles p
    WHERE p.application_status = 'approved'
      AND p.email_new_events = true
      AND p.id IS DISTINCT FROM NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_new_event_email_notifications() FROM PUBLIC, anon, authenticated;
-- Administrators may reject any Interac payment, including one they initiated.
CREATE OR REPLACE FUNCTION public.review_manual_payment(
  p_payment_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_note text := NULLIF(btrim(p_note), '');
  v_now timestamptz := now();
  v_duplicate boolean := false;
  v_note_type text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN RAISE EXCEPTION 'Unsupported manual payment action'; END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'A reason is required to reject a manual payment'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Manual review notes must be 1,000 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'interac' THEN RAISE EXCEPTION 'Only Interac payments can be reviewed manually'; END IF;

  IF p_action = 'confirm' AND v_payment.status IN ('succeeded', 'partially_refunded', 'refunded') AND v_payment.manual_review_status = 'confirmed' THEN
    v_duplicate := true;
  ELSIF p_action = 'reject' AND v_payment.status = 'failed' AND v_payment.manual_review_status = 'rejected' THEN
    v_duplicate := true;
  ELSE
    IF v_payment.status <> 'pending' OR (v_payment.manual_review_status IS DISTINCT FROM 'submitted' AND v_payment.manual_review_status IS DISTINCT FROM 'investigating') THEN
      RAISE EXCEPTION 'This manual payment is no longer awaiting review';
    END IF;

    IF p_action = 'confirm' THEN
      UPDATE public.payments SET status = 'succeeded', succeeded_at = v_now,
        manual_review_status = 'confirmed', manual_confirmed_at = v_now, manual_confirmed_by = v_actor,
        failure_code = NULL, failure_message = NULL, updated_at = v_now
      WHERE id = p_payment_id;
      -- If fulfillment validation fails, PostgreSQL rolls back this entire function call.
      PERFORM public.fulfill_successful_payment(p_payment_id);
      v_note_type := 'internal';
    ELSE
      UPDATE public.payments SET status = 'failed', failed_at = v_now,
        failure_code = 'manual_rejected', failure_message = left(v_note, 1000),
        manual_review_status = 'rejected', manual_rejected_at = v_now, manual_rejected_by = v_actor,
        updated_at = v_now WHERE id = p_payment_id;
      -- Keep the associated record unpaid and explicitly expose failure where supported.
      IF v_payment.purpose = 'event_registration' THEN
        UPDATE public.registrations SET payment_status = 'failed', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id
          AND status = 'confirmed' AND payment_status IN ('pending', 'failed');
      ELSIF v_payment.purpose = 'membership' AND v_payment.business_record_id !~ '^family:' THEN
        UPDATE public.memberships SET payment_status = 'unpaid', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id AND status <> 'active';
      END IF;
      v_note_type := 'rejection';
    END IF;

    IF v_note IS NOT NULL THEN
      INSERT INTO public.payment_manual_review_notes(payment_id, actor_user_id, note_type, note)
      VALUES (p_payment_id, v_actor, v_note_type, left(v_note, 1000));
    END IF;

    INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, source, summary, changes)
    VALUES (v_actor, 'admin', 'payment.manual_' || p_action, 'success', 'payments', p_payment_id::text,
      'manual_payment_review',
      CASE p_action WHEN 'confirm' THEN 'Manual Interac payment confirmed.' ELSE 'Manual Interac payment rejected.' END,
      jsonb_build_object('provider', v_payment.provider, 'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id));
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'userId', v_payment.user_id,
    'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id,
    'amountMinor', v_payment.amount_minor, 'currency', v_payment.currency,
    'status', v_payment.status, 'manualReviewStatus', v_payment.manual_review_status, 'duplicate', v_duplicate);
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text, text) TO authenticated;

-- Skip child-delete audit inserts when the parent tournament event is being deleted.
CREATE OR REPLACE FUNCTION public.audit_tournament_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
 v_event_id := CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='DELETE' AND NOT EXISTS (
   SELECT 1 FROM public.events WHERE id=v_event_id
 ) THEN
   RETURN OLD;
 END IF;
 IF TG_OP<>'INSERT' THEN v_before := to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN v_after := to_jsonb(NEW); END IF;
 INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(v_event_id,v_actor,lower(TG_OP),TG_TABLE_NAME,v_id,v_before,v_after);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
