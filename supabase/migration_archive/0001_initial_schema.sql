-- BEGIN MIGRATION: 0001_initial_schema.sql
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
-- END MIGRATION: 0001_initial_schema.sql
